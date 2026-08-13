const PlatformConfig = require('../models/platformConfigModel');
const Studio = require('../models/studioModel');
const ApiError = require('./ApiError');
const { PLATFORM_CONFIG_DEFAULTS, PLATFORM_GROUP_KEYS } = require('../config/platformDefaults');
const { DEFAULT_PRICING_CONFIG } = require('../config/pricingDefaults');
const { ELAYCOIN_SITUATIONS } = require('../config/elaycoinConfig');

const mergePlatformConfig = (doc) => {
    const stored = doc?.toObject ? doc.toObject() : doc || {};
    const merged = {
        ...PLATFORM_CONFIG_DEFAULTS,
        ...stored,
        gruppen_groessen: {
            ...PLATFORM_CONFIG_DEFAULTS.gruppen_groessen,
            ...(stored.gruppen_groessen || {}),
        },
    };

    return {
        coinWert: merged.coinWert,
        minWert: merged.minWert,
        maxWert: merged.maxWert,
        deckelProzent: merged.deckelProzent,
        verfallMonate: merged.verfallMonate,
        grundgebuehr: merged.grundgebuehr,
        transaktionsProzent: merged.transaktionsProzent,
        zahlungszielTage: merged.zahlungszielTage,
        shop_provision_prozent:
            merged.shop_provision_prozent ?? PLATFORM_CONFIG_DEFAULTS.shop_provision_prozent,
        gruppen_groessen: merged.gruppen_groessen,
        subscription_plans: {
            ...PLATFORM_CONFIG_DEFAULTS.subscription_plans,
            ...(merged.subscription_plans || {}),
        },
        feature_global: merged.feature_global || {},
    };
};

const getPlatformConfig = async () => {
    const doc = await PlatformConfig.findOne({ key: 'platform' });
    return mergePlatformConfig(doc);
};

const ensurePlatformConfig = async () => {
    let doc = await PlatformConfig.findOne({ key: 'platform' });
    if (!doc) {
        doc = await PlatformConfig.create({ key: 'platform' });
    }
    return mergePlatformConfig(doc);
};

const validatePlatformPatch = (patch, current = PLATFORM_CONFIG_DEFAULTS) => {
    const numericFields = [
        'coinWert',
        'minWert',
        'maxWert',
        'deckelProzent',
        'verfallMonate',
        'grundgebuehr',
        'transaktionsProzent',
        'zahlungszielTage',
    ];

    for (const field of numericFields) {
        if (patch[field] !== undefined && (typeof patch[field] !== 'number' || patch[field] < 0)) {
            throw new ApiError(400, `${field} must be a non-negative number`);
        }
    }

    if (patch.gruppen_groessen) {
        const gg = patch.gruppen_groessen;
        const ggFields = ['klein_max_cm2', 'mittelgross_max_cm2', 'max_punkte', 'gruppen_rabatt'];
        for (const field of ggFields) {
            if (gg[field] !== undefined && (typeof gg[field] !== 'number' || gg[field] < 0)) {
                throw new ApiError(400, `gruppen_groessen.${field} must be a non-negative number`);
            }
        }
    }

    const merged = {
        ...current,
        ...patch,
        gruppen_groessen: {
            ...current.gruppen_groessen,
            ...(patch.gruppen_groessen || {}),
        },
    };

    if (
        merged.gruppen_groessen.klein_max_cm2 > merged.gruppen_groessen.mittelgross_max_cm2
    ) {
        throw new ApiError(400, 'klein_max_cm2 must not exceed mittelgross_max_cm2');
    }

    if (merged.minWert > merged.maxWert) {
        throw new ApiError(400, 'minWert must not exceed maxWert');
    }
    if (merged.coinWert < merged.minWert || merged.coinWert > merged.maxWert) {
        throw new ApiError(400, 'coinWert must be within minWert and maxWert');
    }
};

const updatePlatformConfig = async (patch) => {
    const current = await getPlatformConfig();
    validatePlatformPatch(patch, current);

    const setFields = { ...patch };
    if (patch.gruppen_groessen) {
        for (const [k, v] of Object.entries(patch.gruppen_groessen)) {
            setFields[`gruppen_groessen.${k}`] = v;
        }
        delete setFields.gruppen_groessen;
    }

    const doc = await PlatformConfig.findOneAndUpdate(
        { key: 'platform' },
        { $set: setFields },
        { upsert: true, new: true, runValidators: true }
    );

    return mergePlatformConfig(doc);
};

const getPublicConfig = async () => {
    const platform = await getPlatformConfig();
    return {
        gruppen_groessen: platform.gruppen_groessen,
        elaycoin: {
            coinWert: platform.coinWert,
            minWert: platform.minWert,
            maxWert: platform.maxWert,
            deckelProzent: platform.deckelProzent,
            verfallMonate: platform.verfallMonate,
        },
        shop_provision_prozent: platform.shop_provision_prozent,
        stripe_connect_enabled: Boolean(
            process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim()
        ),
    };
};

const STUDIO_PRICING_KEYS = Object.keys(DEFAULT_PRICING_CONFIG).filter(
    (k) => !PLATFORM_GROUP_KEYS.includes(k)
);

const pickStudioPricing = (raw = {}) => {
    const picked = {};
    for (const key of STUDIO_PRICING_KEYS) {
        if (raw[key] !== undefined) {
            picked[key] = raw[key];
        }
    }
    return picked;
};

const validateStudioCoinWert = (coinWert, platform) => {
    if (coinWert === undefined || coinWert === null) {
        return;
    }
    if (typeof coinWert !== 'number' || coinWert < 0) {
        throw new ApiError(400, 'coin_wert must be a non-negative number');
    }
    if (coinWert < platform.minWert || coinWert > platform.maxWert) {
        throw new ApiError(
            400,
            `coin_wert must be between ${platform.minWert} and ${platform.maxWert} CHF`
        );
    }
};

const validateElaycoinStudioCfg = (cfg = {}) => {
    if (typeof cfg !== 'object' || Array.isArray(cfg)) {
        throw new ApiError(400, 'elaycoin_studio_cfg must be an object');
    }

    const allowedKeys = new Set(ELAYCOIN_SITUATIONS.map((s) => s.key));

    for (const [key, value] of Object.entries(cfg)) {
        if (!allowedKeys.has(key)) {
            throw new ApiError(400, `Unknown elaycoin situation key: ${key}`);
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
            throw new ApiError(400, `elaycoin_studio_cfg.${key} must be an object`);
        }
        if (value.coins !== undefined && (typeof value.coins !== 'number' || value.coins < 0)) {
            throw new ApiError(400, `${key}.coins must be a non-negative number`);
        }
        if (value.aktiv !== undefined && typeof value.aktiv !== 'boolean') {
            throw new ApiError(400, `${key}.aktiv must be a boolean`);
        }
    }
};

const getEffectivePricingOverrides = async (studioId) => {
    const platform = await getPlatformConfig();
    const groupOverrides = platform.gruppen_groessen || {};

    if (!studioId) {
        return { ...groupOverrides };
    }

    const studio = await Studio.findById(studioId).select('studio_pricing').lean();
    return {
        ...pickStudioPricing(studio?.studio_pricing || {}),
        ...groupOverrides,
    };
};

const resolveEffectiveCoinWert = async (studioId) => {
    const platform = await getPlatformConfig();
    if (!studioId) {
        return platform.coinWert;
    }
    const studio = await Studio.findById(studioId).select('coin_wert').lean();
    return studio?.coin_wert ?? platform.coinWert;
};

const formatStudioConfig = (studio, platform) => {
    const doc = studio.toObject ? studio.toObject() : studio;
    const coinWert = doc.coin_wert ?? platform.coinWert;

    return {
        studio_id: doc._id,
        studio_code: doc.studio_code,
        firma: doc.firma,
        coin_wert: coinWert,
        studio_pricing: pickStudioPricing(doc.studio_pricing || {}),
        /** Platform defaults for every studio-editable pricing key — UI placeholders. */
        pricing_defaults: Object.fromEntries(
            STUDIO_PRICING_KEYS.map((key) => [key, DEFAULT_PRICING_CONFIG[key]])
        ),
        elaycoin_studio_cfg: doc.elaycoin_studio_cfg || {},
        subscription_plan: doc.subscription_plan || 'professional',
        feature_overrides: doc.feature_overrides || {},
        platform_limits: {
            coinWert: platform.coinWert,
            minWert: platform.minWert,
            maxWert: platform.maxWert,
            deckelProzent: platform.deckelProzent,
            verfallMonate: platform.verfallMonate,
            shop_provision_prozent: platform.shop_provision_prozent,
        },
    };
};

const updateStudioConfig = async (studioId, patch) => {
    const platform = await getPlatformConfig();
    const studio = await Studio.findById(studioId);

    if (!studio) {
        throw new ApiError(404, 'Studio not found');
    }

    if (patch.coin_wert !== undefined) {
        validateStudioCoinWert(patch.coin_wert, platform);
        studio.coin_wert = patch.coin_wert;
    }

    if (patch.studio_pricing !== undefined) {
        studio.studio_pricing = pickStudioPricing(patch.studio_pricing);
        studio.markModified('studio_pricing');
    }

    if (patch.elaycoin_studio_cfg !== undefined) {
        validateElaycoinStudioCfg(patch.elaycoin_studio_cfg);
        studio.elaycoin_studio_cfg = patch.elaycoin_studio_cfg;
        studio.markModified('elaycoin_studio_cfg');
    }

    if (patch.subscription_plan !== undefined) {
        const allowed = ['basic', 'professional', 'enterprise'];
        if (!allowed.includes(patch.subscription_plan)) {
            throw new ApiError(400, 'Invalid subscription_plan');
        }
        studio.subscription_plan = patch.subscription_plan;
    }

    if (patch.feature_overrides !== undefined) {
        if (typeof patch.feature_overrides !== 'object' || Array.isArray(patch.feature_overrides)) {
            throw new ApiError(400, 'feature_overrides must be an object');
        }
        studio.feature_overrides = patch.feature_overrides;
        studio.markModified('feature_overrides');
    }

    await studio.save();
    return formatStudioConfig(studio, platform);
};

module.exports = {
    mergePlatformConfig,
    getPlatformConfig,
    ensurePlatformConfig,
    updatePlatformConfig,
    getPublicConfig,
    getEffectivePricingOverrides,
    resolveEffectiveCoinWert,
    formatStudioConfig,
    updateStudioConfig,
    pickStudioPricing,
    STUDIO_PRICING_KEYS,
};

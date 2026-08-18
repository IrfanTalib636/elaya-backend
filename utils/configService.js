const PlatformConfig = require('../models/platformConfigModel');
const Studio = require('../models/studioModel');
const ApiError = require('./ApiError');
const { PLATFORM_CONFIG_DEFAULTS, PLATFORM_GROUP_KEYS } = require('../config/platformDefaults');
const { DEFAULT_PRICING_CONFIG } = require('../config/pricingDefaults');
const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
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
        session_prediction: mergeSessionPrediction(merged.session_prediction),
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

const assertFiniteNumber = (value, path) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ApiError(400, `${path} must be a number`);
    }
};

const validateNumberMap = (map, path) => {
    if (map === undefined) return;
    if (typeof map !== 'object' || Array.isArray(map) || map == null) {
        throw new ApiError(400, `${path} must be an object`);
    }
    for (const [key, value] of Object.entries(map)) {
        if (value !== undefined) assertFiniteNumber(value, `${path}.${key}`);
    }
};

const validateSessionPredictionPatch = (patch) => {
    if (patch === undefined) return;
    if (typeof patch !== 'object' || Array.isArray(patch) || patch == null) {
        throw new ApiError(400, 'session_prediction must be an object');
    }

    const numeric = ['base_sessions', 'min_sessions', 'max_sessions', 'range_minus', 'range_plus'];
    for (const field of numeric) {
        if (patch[field] !== undefined) assertFiniteNumber(patch[field], `session_prediction.${field}`);
    }

    if (patch.tattoo_deltas) {
        if (typeof patch.tattoo_deltas !== 'object' || Array.isArray(patch.tattoo_deltas)) {
            throw new ApiError(400, 'session_prediction.tattoo_deltas must be an object');
        }
        for (const [group, map] of Object.entries(patch.tattoo_deltas)) {
            validateNumberMap(map, `session_prediction.tattoo_deltas.${group}`);
        }
    }

    if (patch.lifestyle_scores) {
        if (typeof patch.lifestyle_scores !== 'object' || Array.isArray(patch.lifestyle_scores)) {
            throw new ApiError(400, 'session_prediction.lifestyle_scores must be an object');
        }
        for (const [group, map] of Object.entries(patch.lifestyle_scores)) {
            validateNumberMap(map, `session_prediction.lifestyle_scores.${group}`);
        }
    }

    if (patch.aftercare_extra_max) {
        validateNumberMap(patch.aftercare_extra_max, 'session_prediction.aftercare_extra_max');
    }

    if (patch.lifestyle_bands !== undefined) {
        if (!Array.isArray(patch.lifestyle_bands) || patch.lifestyle_bands.length === 0) {
            throw new ApiError(400, 'session_prediction.lifestyle_bands must be a non-empty array');
        }
        patch.lifestyle_bands.forEach((band, i) => {
            if (typeof band !== 'object' || band == null) {
                throw new ApiError(400, `session_prediction.lifestyle_bands[${i}] must be an object`);
            }
            assertFiniteNumber(band.max_avg, `session_prediction.lifestyle_bands[${i}].max_avg`);
            assertFiniteNumber(band.score, `session_prediction.lifestyle_bands[${i}].score`);
            assertFiniteNumber(band.multiplier, `session_prediction.lifestyle_bands[${i}].multiplier`);
        });
    }
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

    if (patch.session_prediction) {
        validateSessionPredictionPatch(patch.session_prediction);
        const mergedSessions = mergeSessionPrediction({
            ...current.session_prediction,
            ...patch.session_prediction,
            tattoo_deltas: {
                ...(current.session_prediction?.tattoo_deltas || {}),
                ...(patch.session_prediction.tattoo_deltas || {}),
            },
            lifestyle_scores: {
                ...(current.session_prediction?.lifestyle_scores || {}),
                ...(patch.session_prediction.lifestyle_scores || {}),
            },
            aftercare_extra_max: {
                ...(current.session_prediction?.aftercare_extra_max || {}),
                ...(patch.session_prediction.aftercare_extra_max || {}),
            },
        });
        if (mergedSessions.min_sessions > mergedSessions.max_sessions) {
            throw new ApiError(400, 'min_sessions must not exceed max_sessions');
        }
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
    if (patch.session_prediction) {
        setFields.session_prediction = mergeSessionPrediction({
            ...current.session_prediction,
            ...patch.session_prediction,
            tattoo_deltas: {
                ...(current.session_prediction?.tattoo_deltas || {}),
                ...(patch.session_prediction.tattoo_deltas || {}),
            },
            lifestyle_scores: {
                ...(current.session_prediction?.lifestyle_scores || {}),
                ...(patch.session_prediction.lifestyle_scores || {}),
            },
            aftercare_extra_max: {
                ...(current.session_prediction?.aftercare_extra_max || {}),
                ...(patch.session_prediction.aftercare_extra_max || {}),
            },
        });
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
        return {
            ...groupOverrides,
            session_prediction: platform.session_prediction,
        };
    }

    const studio = await Studio.findById(studioId).select('studio_pricing').lean();
    return {
        ...pickStudioPricing(studio?.studio_pricing || {}),
        ...groupOverrides,
        session_prediction: platform.session_prediction,
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
        session_prediction: platform.session_prediction,
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

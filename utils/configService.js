const PlatformConfig = require('../models/platformConfigModel');
const Studio = require('../models/studioModel');
const ApiError = require('./ApiError');
const {
    PLATFORM_CONFIG_DEFAULTS,
    GRUPPEN_PUNKTE,
    PLATFORM_GROUP_KEYS,
    NUMERIC_CONFIG_BLOCKS,
    STUDIO_OVERRIDABLE_BLOCKS,
    blockKeys,
} = require('../config/platformDefaults');
const { DEFAULT_PRICING_CONFIG } = require('../config/pricingDefaults');
const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
const { ELAYCOIN_SITUATIONS } = require('../config/elaycoinConfig');

/** Three-layer merge for one numeric settings block: defaults → platform → studio. */
const mergeNumericBlock = (block, platform, studioDoc) => ({
    ...PLATFORM_CONFIG_DEFAULTS[block],
    ...(platform?.[block] || {}),
    ...(studioDoc?.[block] || {}),
});

const mergePlatformConfig = (doc) => {
    const stored = doc?.toObject ? doc.toObject() : doc || {};
    const merged = {
        ...PLATFORM_CONFIG_DEFAULTS,
        ...stored,
        ...Object.fromEntries(
            NUMERIC_CONFIG_BLOCKS.map((block) => [
                block,
                { ...PLATFORM_CONFIG_DEFAULTS[block], ...(stored[block] || {}) },
            ])
        ),
    };

    return {
        sperrfristen: merged.sperrfristen,
        termin_einstellungen: merged.termin_einstellungen,
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

/**
 * Every value in a numeric settings block must be a known key and a
 * non-negative number. Shared by the platform and studio update paths so both
 * reject the same input.
 */
const assertNumericBlockPatch = (block, patch) => {
    if (patch === undefined) return;
    if (typeof patch !== 'object' || Array.isArray(patch) || patch == null) {
        throw new ApiError(400, `${block} must be an object`);
    }
    const allowed = blockKeys(block);
    for (const [key, value] of Object.entries(patch)) {
        if (!allowed.includes(key)) {
            throw new ApiError(400, `Unknown ${block} field: ${key}`);
        }
        if (value !== undefined && (typeof value !== 'number' || value < 0)) {
            throw new ApiError(400, `${block}.${key} must be a non-negative number`);
        }
    }
};

/** Cross-field rules that a single value cannot express on its own. */
const assertBlockInvariants = (block, next) => {
    if (block === 'gruppen_groessen') {
        const defaults = PLATFORM_CONFIG_DEFAULTS.gruppen_groessen;
        // Strict: equal thresholds would leave the medium tier unreachable,
        // since a case is medium only when klein < area <= mittelgross.
        if (
            (next.klein_max_cm2 ?? defaults.klein_max_cm2) >=
            (next.mittelgross_max_cm2 ?? defaults.mittelgross_max_cm2)
        ) {
            throw new ApiError(400, 'klein_max_cm2 must be less than mittelgross_max_cm2');
        }
        if (next.gruppen_rabatt != null && next.gruppen_rabatt > 1) {
            throw new ApiError(400, 'gruppen_rabatt must be between 0 and 1');
        }
    }

    if (block === 'sperrfristen') {
        if (
            next.uv_mittel_tage != null &&
            next.uv_intensiv_tage != null &&
            next.uv_mittel_tage > next.uv_intensiv_tage
        ) {
            throw new ApiError(400, 'uv_mittel_tage must not exceed uv_intensiv_tage');
        }
    }

    if (block === 'termin_einstellungen') {
        if (next.buchung_horizont_tage != null && next.buchung_horizont_tage < 1) {
            throw new ApiError(400, 'buchung_horizont_tage must be at least 1');
        }
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

    for (const block of NUMERIC_CONFIG_BLOCKS) {
        assertNumericBlockPatch(block, patch[block]);
    }

    const merged = {
        ...current,
        ...patch,
        ...Object.fromEntries(
            NUMERIC_CONFIG_BLOCKS.map((block) => [
                block,
                { ...current[block], ...(patch[block] || {}) },
            ])
        ),
    };

    for (const block of NUMERIC_CONFIG_BLOCKS) {
        assertBlockInvariants(block, merged[block]);
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

    // Dotted paths so a partial patch never wipes sibling keys.
    const setFields = { ...patch };
    for (const block of NUMERIC_CONFIG_BLOCKS) {
        if (!patch[block]) continue;
        for (const [key, value] of Object.entries(patch[block])) {
            setFields[`${block}.${key}`] = value;
        }
        delete setFields[block];
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

const mergeGruppenGroessen = (platform, studioDoc) =>
    mergeNumericBlock('gruppen_groessen', platform, studioDoc);

const getEffectiveGruppenGroessen = async (studioId) => {
    const platform = await getPlatformConfig();
    if (!studioId) {
        return mergeGruppenGroessen(platform, null);
    }
    const studio = await Studio.findById(studioId).select('gruppen_groessen').lean();
    return mergeGruppenGroessen(platform, studio);
};

/**
 * Blocking periods and appointment settings for one studio, resolved in a
 * single pair of reads. The booking and lockout paths call this per request, so
 * no duration is ever read from a hardcoded constant.
 */
const getEffectiveBookingConfig = async (studioId) => {
    const platform = await getPlatformConfig();
    const studio = studioId
        ? await Studio.findById(studioId).select('sperrfristen termin_einstellungen').lean()
        : null;
    return {
        sperrfristen: mergeNumericBlock('sperrfristen', platform, studio),
        termin_einstellungen: mergeNumericBlock('termin_einstellungen', platform, studio),
    };
};

const getEffectiveSperrfristen = async (studioId) =>
    (await getEffectiveBookingConfig(studioId)).sperrfristen;

const getPublicConfig = async (studioId = null) => {
    const platform = await getPlatformConfig();
    const gruppen_groessen = studioId
        ? await getEffectiveGruppenGroessen(studioId)
        : mergeGruppenGroessen(platform, null);
    const booking = await getEffectiveBookingConfig(studioId);
    return {
        gruppen_groessen,
        gruppen_punkte: GRUPPEN_PUNKTE,
        sperrfristen: booking.sperrfristen,
        termin_einstellungen: booking.termin_einstellungen,
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
        /** Points per size category — read-only, so the UI can label each tier. */
        gruppen_punkte: GRUPPEN_PUNKTE,
        ...Object.fromEntries(
            STUDIO_OVERRIDABLE_BLOCKS.flatMap((block) => [
                [block, mergeNumericBlock(block, platform, doc)],
                // Platform values, so the UI can show what a cleared field falls back to.
                [`${block}_defaults`, mergeNumericBlock(block, platform, null)],
            ])
        ),
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

    for (const block of STUDIO_OVERRIDABLE_BLOCKS) {
        if (patch[block] === undefined) continue;
        assertNumericBlockPatch(block, patch[block]);
        const next = { ...(studio[block] || {}), ...patch[block] };
        assertBlockInvariants(block, next);
        studio[block] = next;
        studio.markModified(block);
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
    assertBlockInvariants,
    getPlatformConfig,
    ensurePlatformConfig,
    updatePlatformConfig,
    getPublicConfig,
    getEffectiveGruppenGroessen,
    getEffectiveBookingConfig,
    getEffectiveSperrfristen,
    mergeGruppenGroessen,
    mergeNumericBlock,
    getEffectivePricingOverrides,
    resolveEffectiveCoinWert,
    formatStudioConfig,
    updateStudioConfig,
    pickStudioPricing,
    STUDIO_PRICING_KEYS,
};

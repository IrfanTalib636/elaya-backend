const PlatformConfig = require('../models/platformConfigModel');
const Studio = require('../models/studioModel');
const ApiError = require('./ApiError');
const {
    PLATFORM_CONFIG_DEFAULTS,
    GRUPPEN_PUNKTE,
    PLATFORM_GROUP_KEYS,
    NUMERIC_CONFIG_BLOCKS,
    STUDIO_OVERRIDABLE_BLOCKS,
    SUPER_ADMIN_ONLY_CONFIG_BLOCKS,
    blockKeys,
} = require('../config/platformDefaults');
const {
    normalizePackagesList,
    normalizeKiGewichtungen,
    derivePlanConfigFromPackages,
} = require('../config/subscriptionPackages');
const { DEFAULT_PRICING_CONFIG } = require('../config/pricingDefaults');
const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
const { ELAYCOIN_SITUATIONS } = require('../config/elaycoinConfig');
const { cloneAutomations } = require('../config/automationsDefaults');

/**
 * Merge platform Automatisierungen catalog with studio overrides.
 * Studio may only change aktiv + tage (wert) when editierbar_studio=true.
 */
const mergeEffectiveAutomations = (platform = {}, studioOverrides = {}) => {
    const base =
        Array.isArray(platform.automatisierungen?.kategorien) &&
        platform.automatisierungen.kategorien.length
            ? cloneAutomations(platform.automatisierungen)
            : cloneAutomations();
    const overrides =
        studioOverrides && typeof studioOverrides === 'object' ? studioOverrides : {};

    base.kategorien = (base.kategorien || []).map((kat) => ({
        ...kat,
        regeln: (kat.regeln || []).map((rule) => {
            const ov = overrides[rule.id] || {};
            const editable = rule.editierbar_studio !== false;
            let aktiv = rule.aktiv !== false;
            let tage_wert = rule.tage_wert;
            if (editable) {
                if (ov.aktiv !== undefined) aktiv = !!ov.aktiv;
                if (rule.hat_tage_feld && ov.wert != null) {
                    const mn = rule.tage_min != null ? rule.tage_min : 1;
                    const mx = rule.tage_max != null ? rule.tage_max : 365;
                    const n = parseInt(ov.wert, 10);
                    if (!Number.isNaN(n)) {
                        tage_wert = Math.max(mn, Math.min(mx, n));
                    }
                }
            }
            return {
                ...rule,
                aktiv,
                tage_wert,
                effective_editierbar: editable,
            };
        }),
    }));
    return base;
};

const STUDIO_PRICING_KEYS = Object.keys(DEFAULT_PRICING_CONFIG).filter(
    (k) => !PLATFORM_GROUP_KEYS.includes(k)
);

const pickStudioPricing = (raw = {}) => {
    const picked = {};
    for (const key of STUDIO_PRICING_KEYS) {
        if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') {
            const n = Number(raw[key]);
            if (Number.isFinite(n)) picked[key] = n;
        }
    }
    return picked;
};

/** Static code defaults ← platform default_pricing overrides. */
const mergeDefaultPricing = (platform) => ({
    ...DEFAULT_PRICING_CONFIG,
    ...pickStudioPricing(platform?.default_pricing || {}),
});

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
        elaycoin_regeln: {
            ...PLATFORM_CONFIG_DEFAULTS.elaycoin_regeln,
            ...(merged.elaycoin_regeln || {}),
            verfall_reset_trigger: Array.isArray(merged.elaycoin_regeln?.verfall_reset_trigger)
                ? merged.elaycoin_regeln.verfall_reset_trigger
                : [...PLATFORM_CONFIG_DEFAULTS.elaycoin_regeln.verfall_reset_trigger],
            situations: Array.isArray(merged.elaycoin_regeln?.situations) &&
            merged.elaycoin_regeln.situations.length
                ? merged.elaycoin_regeln.situations
                : PLATFORM_CONFIG_DEFAULTS.elaycoin_regeln.situations.map((s) => ({ ...s })),
        },
        automatisierungen:
            Array.isArray(merged.automatisierungen?.kategorien) &&
            merged.automatisierungen.kategorien.length
                ? {
                      version: merged.automatisierungen.version || 1,
                      kategorien: merged.automatisierungen.kategorien,
                  }
                : JSON.parse(JSON.stringify(PLATFORM_CONFIG_DEFAULTS.automatisierungen)),
        grundgebuehr: merged.grundgebuehr,
        transaktionsProzent: merged.transaktionsProzent,
        zahlungszielTage: merged.zahlungszielTage,
        shop_provision_prozent:
            merged.shop_provision_prozent ?? PLATFORM_CONFIG_DEFAULTS.shop_provision_prozent,
        shop_categories:
            Array.isArray(merged.shop_categories) && merged.shop_categories.length
                ? merged.shop_categories
                : [...PLATFORM_CONFIG_DEFAULTS.shop_categories],
        shop_shipping: {
            ...PLATFORM_CONFIG_DEFAULTS.shop_shipping,
            ...(merged.shop_shipping || {}),
        },
        gruppen_groessen: merged.gruppen_groessen,
        subscription_plans: {
            ...PLATFORM_CONFIG_DEFAULTS.subscription_plans,
            ...(merged.subscription_plans || {}),
        },
        subscription_seat_limits: {
            ...PLATFORM_CONFIG_DEFAULTS.subscription_seat_limits,
            ...(merged.subscription_seat_limits || {}),
        },
        subscription_packages: normalizePackagesList(
            Array.isArray(merged.subscription_packages) && merged.subscription_packages.length
                ? merged.subscription_packages
                : PLATFORM_CONFIG_DEFAULTS.subscription_packages
        ),
        ki_gewichtungen: normalizeKiGewichtungen(
            merged.ki_gewichtungen || PLATFORM_CONFIG_DEFAULTS.ki_gewichtungen
        ),
        feature_global: merged.feature_global || {},
        session_prediction: mergeSessionPrediction(merged.session_prediction),
        default_pricing: pickStudioPricing(merged.default_pricing || {}),
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

/** Nested object keys inside sperrfristen (not day-count numbers). */
const SPERRFRISTEN_OBJECT_KEYS = new Set(['condition_locks', 'studio_exceptions']);

/**
 * Every value in a numeric settings block must be a known key and a
 * non-negative number. Shared by the platform and studio update paths so both
 * reject the same input. Sperrfristen also allows condition_locks /
 * studio_exceptions objects (Medical & Safety).
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
        if (block === 'sperrfristen' && SPERRFRISTEN_OBJECT_KEYS.has(key)) {
            if (value !== undefined && (typeof value !== 'object' || Array.isArray(value) || value == null)) {
                throw new ApiError(400, `${block}.${key} must be an object`);
            }
            continue;
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
        const ranges = {
            same_case_tage: [14, 180],
            cross_case_tage: [7, 180],
            uv_mittel_tage: [0, 180],
            uv_intensiv_tage: [0, 180],
            medikament_kurz_tage: [0, 180],
            medikament_retinoide_tage: [0, 365],
        };
        for (const [key, [min, max]] of Object.entries(ranges)) {
            if (next[key] == null) continue;
            const n = Number(next[key]);
            if (!Number.isFinite(n) || n < min || n > max) {
                throw new ApiError(400, `${key} must be between ${min} and ${max}`);
            }
        }
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

    if (patch.default_pricing !== undefined) {
        if (
            typeof patch.default_pricing !== 'object' ||
            Array.isArray(patch.default_pricing) ||
            patch.default_pricing == null
        ) {
            throw new ApiError(400, 'default_pricing must be an object');
        }
        validateNumberMap(pickStudioPricing(patch.default_pricing), 'default_pricing');
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
    if (patch.default_pricing !== undefined) {
        setFields.default_pricing = {
            ...pickStudioPricing(current.default_pricing || {}),
            ...pickStudioPricing(patch.default_pricing),
        };
    }
    if (patch.elaycoin_regeln && typeof patch.elaycoin_regeln === 'object') {
        const prev = current.elaycoin_regeln || PLATFORM_CONFIG_DEFAULTS.elaycoin_regeln;
        const next = {
            ...prev,
            ...patch.elaycoin_regeln,
            verfall_reset_trigger: Array.isArray(patch.elaycoin_regeln.verfall_reset_trigger)
                ? patch.elaycoin_regeln.verfall_reset_trigger
                : prev.verfall_reset_trigger,
            situations: Array.isArray(patch.elaycoin_regeln.situations)
                ? patch.elaycoin_regeln.situations
                : prev.situations,
        };
        if (
            next.grenze_pro_aktion_min != null &&
            next.grenze_pro_aktion_max != null &&
            next.grenze_pro_aktion_min > next.grenze_pro_aktion_max
        ) {
            throw new ApiError(400, 'grenze_pro_aktion_min must not exceed grenze_pro_aktion_max');
        }
        setFields.elaycoin_regeln = next;
        const coins = Number(next.geldwert_coins);
        const chf = Number(next.geldwert_chf);
        if (coins > 0 && Number.isFinite(chf)) {
            // Keep legacy coinWert in sync: CHF per coin = chf / coins (100→5 ⇒ 0.05).
            setFields.coinWert = Math.round((chf / coins) * 10000) / 10000;
        }
    }
    if (patch.automatisierungen && typeof patch.automatisierungen === 'object') {
        const next = patch.automatisierungen;
        if (!Array.isArray(next.kategorien)) {
            throw new ApiError(400, 'automatisierungen.kategorien must be an array');
        }
        setFields.automatisierungen = {
            version: Number(next.version) || 1,
            kategorien: next.kategorien,
        };
    }
    if (Array.isArray(patch.subscription_packages)) {
        const nextPkgs = normalizePackagesList(patch.subscription_packages);
        setFields.subscription_packages = nextPkgs;
        const derived = derivePlanConfigFromPackages(nextPkgs);
        setFields.subscription_plans = derived.subscription_plans;
        setFields.subscription_seat_limits = {
            ...(current.subscription_seat_limits || {}),
            ...derived.subscription_seat_limits,
        };
    }
    if (patch.ki_gewichtungen && typeof patch.ki_gewichtungen === 'object') {
        setFields.ki_gewichtungen = normalizeKiGewichtungen({
            ...(current.ki_gewichtungen || PLATFORM_CONFIG_DEFAULTS.ki_gewichtungen),
            ...patch.ki_gewichtungen,
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
    let sperrfristen = mergeNumericBlock('sperrfristen', platform, studio);
    const exc =
        studioId && platform.sperrfristen?.studio_exceptions
            ? platform.sperrfristen.studio_exceptions[String(studioId)]
            : null;
    // Prototype §22: Date Locks can be disabled per studio; Condition Locks stay mandatory.
    if (exc?.date_locks_disabled) {
        sperrfristen = {
            ...sperrfristen,
            same_case_tage: 0,
            cross_case_tage: 0,
            uv_mittel_tage: 0,
            uv_intensiv_tage: 0,
            medikament_kurz_tage: 0,
            medikament_retinoide_tage: 0,
            date_locks_disabled: true,
        };
    }
    return {
        sperrfristen,
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
    const base = mergeDefaultPricing(platform);

    if (!studioId) {
        return {
            ...base,
            ...groupOverrides,
            session_prediction: platform.session_prediction,
        };
    }

    const studio = await Studio.findById(studioId).select('studio_pricing').lean();
    return {
        ...base,
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
        /** Platform price rules (code defaults ← platform default_pricing). */
        pricing_defaults: mergeDefaultPricing(platform),
        elaycoin_studio_cfg: doc.elaycoin_studio_cfg || {},
        /** Platform Elaycoin-Regeln — studio read-only reference. */
        elaycoin_regeln: platform.elaycoin_regeln,
        /**
         * Effective Automations (platform catalog + studio overrides).
         * Studio may PATCH automatisierungen_overrides for editierbar_studio rules only.
         */
        automatisierungen: mergeEffectiveAutomations(
            platform,
            doc.automatisierungen_overrides || {}
        ),
        automatisierungen_overrides: doc.automatisierungen_overrides || {},
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
            NUMERIC_CONFIG_BLOCKS.flatMap((block) => [
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

    if (patch.automatisierungen_overrides !== undefined) {
        if (
            typeof patch.automatisierungen_overrides !== 'object' ||
            Array.isArray(patch.automatisierungen_overrides) ||
            patch.automatisierungen_overrides == null
        ) {
            throw new ApiError(400, 'automatisierungen_overrides must be an object');
        }
        const catalog = mergeEffectiveAutomations(platform, {});
        const ruleMap = {};
        for (const kat of catalog.kategorien || []) {
            for (const r of kat.regeln || []) {
                ruleMap[r.id] = r;
            }
        }
        const next = { ...(studio.automatisierungen_overrides || {}) };
        for (const [ruleId, raw] of Object.entries(patch.automatisierungen_overrides)) {
            const rule = ruleMap[ruleId];
            if (!rule) {
                throw new ApiError(400, `Unknown automation rule: ${ruleId}`);
            }
            if (rule.editierbar_studio === false) {
                throw new ApiError(
                    403,
                    `Automation rule ${ruleId} is centrally managed and cannot be changed by the studio`
                );
            }
            if (!raw || typeof raw !== 'object') {
                throw new ApiError(400, `Invalid override for ${ruleId}`);
            }
            const prev = next[ruleId] || {};
            const entry = { ...prev };
            if (raw.aktiv !== undefined) entry.aktiv = !!raw.aktiv;
            if (raw.wert !== undefined) {
                if (!rule.hat_tage_feld) {
                    throw new ApiError(400, `Rule ${ruleId} has no days field`);
                }
                const mn = rule.tage_min != null ? rule.tage_min : 1;
                const mx = rule.tage_max != null ? rule.tage_max : 365;
                const n = parseInt(raw.wert, 10);
                if (Number.isNaN(n) || n < mn || n > mx) {
                    throw new ApiError(
                        400,
                        `Days for ${ruleId} must be between ${mn} and ${mx}`
                    );
                }
                entry.wert = n;
            }
            next[ruleId] = entry;
        }
        studio.automatisierungen_overrides = next;
        studio.markModified('automatisierungen_overrides');
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

    // Medical lockouts: only applied when the controller has already authorized
    // the caller as super_admin (studio users never reach this with sperrfristen).
    for (const block of SUPER_ADMIN_ONLY_CONFIG_BLOCKS) {
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

const {
    PlatformConfigVersion,
    VERSIONED_CONFIG_DOMAINS,
} = require('../models/platformConfigVersionModel');

const assertVersionedDomain = (domain) => {
    if (!VERSIONED_CONFIG_DOMAINS.includes(domain)) {
        throw new ApiError(
            400,
            `Invalid domain. Allowed: ${VERSIONED_CONFIG_DOMAINS.join(', ')}`
        );
    }
};

const cloneDomainSnapshot = (domain, value) => {
    if (domain === 'sperrfristen') {
        return {
            ...PLATFORM_CONFIG_DEFAULTS.sperrfristen,
            ...(value || {}),
        };
    }
    if (domain === 'default_pricing') {
        return pickStudioPricing(value || {});
    }
    return mergeSessionPrediction(value || {});
};

const normalizeDomainPatch = (domain, data, currentLive) => {
    const patch = { [domain]: data };
    validatePlatformPatch(patch, {
        ...PLATFORM_CONFIG_DEFAULTS,
        [domain]: currentLive,
    });

    if (domain === 'sperrfristen') {
        return {
            ...PLATFORM_CONFIG_DEFAULTS.sperrfristen,
            ...(currentLive || {}),
            ...data,
        };
    }
    if (domain === 'default_pricing') {
        return {
            ...pickStudioPricing(currentLive || {}),
            ...pickStudioPricing(data),
        };
    }
    return mergeSessionPrediction({
        ...(currentLive || {}),
        ...data,
        tattoo_deltas: {
            ...(currentLive?.tattoo_deltas || {}),
            ...(data?.tattoo_deltas || {}),
        },
        lifestyle_scores: {
            ...(currentLive?.lifestyle_scores || {}),
            ...(data?.lifestyle_scores || {}),
        },
        aftercare_extra_max: {
            ...(currentLive?.aftercare_extra_max || {}),
            ...(data?.aftercare_extra_max || {}),
        },
    });
};

const getPlatformConfigDoc = async () => {
    let doc = await PlatformConfig.findOne({ key: 'platform' });
    if (!doc) {
        doc = await PlatformConfig.create({ key: 'platform' });
    }
    return doc;
};

const getConfigLifecycle = async (domain) => {
    assertVersionedDomain(domain);
    const doc = await getPlatformConfigDoc();
    const live = mergePlatformConfig(doc);
    const draftEntry = doc.drafts?.[domain] || null;
    return {
        domain,
        published: cloneDomainSnapshot(domain, live[domain]),
        draft: draftEntry
            ? {
                  data: draftEntry.data,
                  updated_at: draftEntry.updated_at || null,
                  updated_by: draftEntry.updated_by || null,
                  note: draftEntry.note || '',
              }
            : null,
        current_version: Number(doc.current_versions?.[domain]) || 0,
        has_draft: Boolean(draftEntry?.data),
    };
};

const saveConfigDraft = async (domain, data, { userId = null, note = '' } = {}) => {
    assertVersionedDomain(domain);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new ApiError(400, 'Draft data must be an object');
    }

    const live = await getPlatformConfig();
    const normalized = normalizeDomainPatch(domain, data, live[domain]);
    const draftPayload = {
        data: normalized,
        updated_by: userId || null,
        updated_at: new Date(),
        note: String(note || '').trim().slice(0, 2000),
    };

    await PlatformConfig.findOneAndUpdate(
        { key: 'platform' },
        { $set: { [`drafts.${domain}`]: draftPayload } },
        { upsert: true, new: true }
    );

    return getConfigLifecycle(domain);
};

const discardConfigDraft = async (domain) => {
    assertVersionedDomain(domain);
    await PlatformConfig.findOneAndUpdate(
        { key: 'platform' },
        { $unset: { [`drafts.${domain}`]: 1 } },
        { upsert: true, new: true }
    );
    return getConfigLifecycle(domain);
};

const listConfigVersions = async (domain, { limit = 50 } = {}) => {
    assertVersionedDomain(domain);
    const rows = await PlatformConfigVersion.find({ domain })
        .sort({ version: -1 })
        .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))
        .populate('published_by', 'email role name')
        .lean();
    return rows.map((row) => ({
        domain: row.domain,
        version: row.version,
        snapshot: row.snapshot,
        note: row.note || '',
        published_at: row.published_at,
        published_by: row.published_by
            ? {
                  id: row.published_by._id,
                  email: row.published_by.email,
                  role: row.published_by.role,
                  name: row.published_by.name,
              }
            : null,
        rolled_back_from: row.rolled_back_from ?? null,
    }));
};

const publishConfigDomain = async (
    domain,
    { userId = null, reason = '', data = null, rolledBackFrom = null } = {}
) => {
    assertVersionedDomain(domain);
    const reasonTrimmed = String(reason || '').trim();
    if (!reasonTrimmed) {
        throw new ApiError(400, 'Publish reason is required');
    }

    const doc = await getPlatformConfigDoc();
    const live = mergePlatformConfig(doc);
    const draftEntry = doc.drafts?.[domain] || null;

    let toPublish;
    if (rolledBackFrom != null && data && typeof data === 'object') {
        // Exact snapshot restore (no merge with current live extras).
        toPublish = cloneDomainSnapshot(domain, data);
        validatePlatformPatch({ [domain]: toPublish }, live);
    } else if (data && typeof data === 'object' && !Array.isArray(data)) {
        toPublish = normalizeDomainPatch(domain, data, live[domain]);
    } else if (draftEntry?.data) {
        toPublish = normalizeDomainPatch(domain, draftEntry.data, live[domain]);
    } else {
        throw new ApiError(400, 'No draft to publish. Save a draft first.');
    }

    const before = cloneDomainSnapshot(domain, live[domain]);
    const nextVersion = (Number(doc.current_versions?.[domain]) || 0) + 1;
    const after = cloneDomainSnapshot(domain, toPublish);

    const updatedDoc = await PlatformConfig.findOneAndUpdate(
        { key: 'platform' },
        {
            $set: {
                [domain]: after,
                [`current_versions.${domain}`]: nextVersion,
            },
            $unset: { [`drafts.${domain}`]: 1 },
        },
        { upsert: true, new: true, runValidators: true }
    );

    await PlatformConfigVersion.create({
        domain,
        version: nextVersion,
        snapshot: after,
        note: reasonTrimmed.slice(0, 2000),
        published_by: userId || null,
        published_at: new Date(),
        rolled_back_from: rolledBackFrom ?? null,
    });

    const updated = mergePlatformConfig(updatedDoc);

    return {
        domain,
        version: nextVersion,
        published: after,
        before,
        current_version: nextVersion,
        has_draft: false,
        draft: null,
        rolled_back_from: rolledBackFrom ?? null,
        platform_config: updated,
    };
};

const rollbackConfigVersion = async (domain, version, { userId = null, reason = '' } = {}) => {
    assertVersionedDomain(domain);
    const versionNum = Number(version);
    if (!Number.isInteger(versionNum) || versionNum < 1) {
        throw new ApiError(400, 'Invalid version number');
    }
    const reasonTrimmed = String(reason || '').trim();
    if (!reasonTrimmed) {
        throw new ApiError(400, 'Rollback reason is required');
    }

    const row = await PlatformConfigVersion.findOne({ domain, version: versionNum }).lean();
    if (!row) {
        throw new ApiError(404, `Version ${versionNum} not found for ${domain}`);
    }

    return publishConfigDomain(domain, {
        userId,
        reason: reasonTrimmed,
        data: row.snapshot,
        rolledBackFrom: versionNum,
    });
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
    mergeEffectiveAutomations,
    updateStudioConfig,
    pickStudioPricing,
    mergeDefaultPricing,
    STUDIO_PRICING_KEYS,
    VERSIONED_CONFIG_DOMAINS,
    getConfigLifecycle,
    saveConfigDraft,
    discardConfigDraft,
    listConfigVersions,
    publishConfigDomain,
    rollbackConfigVersion,
};

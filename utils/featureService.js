const Studio = require('../models/studioModel');
const mongoose = require('mongoose');
const { getPlatformConfig } = require('./configService');
const {
    FEATURE_CATALOG,
    FEATURE_GROUPS,
    FEATURE_KEYS,
    SUBSCRIPTION_PLAN_KEYS,
    CANONICAL_TO_LEGACY,
    resolveCanonicalKey,
    migrateFeatureKeyList,
    migrateFeatureMap,
} = require('../config/featureCatalog');
const { PLATFORM_CONFIG_DEFAULTS } = require('../config/platformDefaults');

const resolvePlanFeatures = (platform, planKey) => {
    const plans = {
        ...PLATFORM_CONFIG_DEFAULTS.subscription_plans,
        ...(platform.subscription_plans || {}),
    };
    const key = SUBSCRIPTION_PLAN_KEYS.includes(planKey) ? planKey : 'professional';
    const list = migrateFeatureKeyList(Array.isArray(plans[key]) ? plans[key] : []);
    return new Set(list.filter((k) => FEATURE_KEYS.includes(k)));
};

/**
 * True when `value` is already a Studio document/lean object (not a bare ObjectId / id string).
 * Important: mongoose ObjectId exposes `_id` as a self-getter, so `id && id._id` is NOT a
 * reliable doc check — that bug caused customer effective-features to ignore studio overrides.
 */
const isStudioDocument = (value) => {
    if (!value || typeof value !== 'object') return false;
    if (value instanceof mongoose.Types.ObjectId) return false;
    if (typeof value.equals === 'function' && value._bsontype === 'ObjectId') return false;
    return (
        value.subscription_plan !== undefined ||
        value.feature_overrides !== undefined ||
        value.firma !== undefined ||
        value.studio_code !== undefined
    );
};

const studioIdFrom = (value) => {
    if (!value) return null;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value instanceof mongoose.Types.ObjectId) return value.toString();
    if (value._id) return String(value._id);
    if (typeof value.toString === 'function' && mongoose.isValidObjectId(value)) {
        return String(value);
    }
    return null;
};

/**
 * Effective feature map for a studio: { [featureKey]: boolean }.
 * Includes canonical keys + legacy aliases (same boolean) for old clients.
 */
const getEffectiveFeaturesForStudio = async (studioIdOrDoc) => {
    const platform = await getPlatformConfig();
    let studio = null;
    if (isStudioDocument(studioIdOrDoc)) {
        studio = studioIdOrDoc;
    } else {
        const id = studioIdFrom(studioIdOrDoc);
        if (id) {
            studio = await Studio.findById(id)
                .select('subscription_plan feature_overrides firma studio_code')
                .lean();
        }
    }

    const plan = studio?.subscription_plan || 'professional';
    const planSet = resolvePlanFeatures(platform, plan);
    const global = migrateFeatureMap(platform.feature_global || {});
    const overrides = migrateFeatureMap(studio?.feature_overrides || {});

    const features = {};
    for (const key of FEATURE_KEYS) {
        // Per-studio force ON/OFF wins — needed for pilot studios (e.g. INKFREE)
        // even when a global kill-switch exists for other studios.
        if (overrides[key] === true) {
            features[key] = true;
            continue;
        }
        if (overrides[key] === false) {
            features[key] = false;
            continue;
        }
        if (global[key] === false) {
            features[key] = false;
            continue;
        }
        features[key] = planSet.has(key);
    }

    // Mirror legacy keys so older mobile/admin clients keep working
    for (const [canonical, legacies] of Object.entries(CANONICAL_TO_LEGACY)) {
        if (!(canonical in features)) continue;
        for (const legacy of legacies) {
            features[legacy] = features[canonical];
        }
    }
    // Special: legacy ai_chat — true if either split chat flag is on
    if ('elaya_chat_kunde' in features || 'ki_studio_assistent' in features) {
        features.ai_chat = Boolean(
            features.elaya_chat_kunde || features.ki_studio_assistent
        );
    }

    return {
        studio_id: studio?._id?.toString() || studioIdFrom(studioIdOrDoc),
        subscription_plan: plan,
        features,
        catalog: FEATURE_CATALOG,
        groups: FEATURE_GROUPS,
        plan_features: [...planSet],
        overrides,
        global_disabled: Object.keys(global).filter((k) => global[k] === false),
    };
};

const isFeatureEnabled = async (studioId, featureKey) => {
    const data = await getEffectiveFeaturesForStudio(studioId);
    const canonical = resolveCanonicalKey(featureKey);
    if (canonical in data.features) return Boolean(data.features[canonical]);
    return Boolean(data.features[featureKey]);
};

module.exports = {
    getEffectiveFeaturesForStudio,
    isFeatureEnabled,
    FEATURE_CATALOG,
    FEATURE_GROUPS,
    FEATURE_KEYS,
};

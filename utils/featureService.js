const Studio = require('../models/studioModel');
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
 * Effective feature map for a studio: { [featureKey]: boolean }.
 * Includes canonical keys + legacy aliases (same boolean) for old clients.
 */
const getEffectiveFeaturesForStudio = async (studioIdOrDoc) => {
    const platform = await getPlatformConfig();
    const studio =
        studioIdOrDoc && studioIdOrDoc._id
            ? studioIdOrDoc
            : studioIdOrDoc
              ? await Studio.findById(studioIdOrDoc)
                    .select('subscription_plan feature_overrides firma studio_code')
                    .lean()
              : null;

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
        studio_id: studio?._id?.toString() || null,
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

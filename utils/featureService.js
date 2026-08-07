const Studio = require('../models/studioModel');
const { getPlatformConfig } = require('./configService');
const {
    FEATURE_CATALOG,
    FEATURE_KEYS,
    SUBSCRIPTION_PLAN_KEYS,
} = require('../config/featureCatalog');
const { PLATFORM_CONFIG_DEFAULTS } = require('../config/platformDefaults');

const resolvePlanFeatures = (platform, planKey) => {
    const plans = {
        ...PLATFORM_CONFIG_DEFAULTS.subscription_plans,
        ...(platform.subscription_plans || {}),
    };
    const key = SUBSCRIPTION_PLAN_KEYS.includes(planKey) ? planKey : 'professional';
    const list = Array.isArray(plans[key]) ? plans[key] : [];
    return new Set(list.filter((k) => FEATURE_KEYS.includes(k)));
};

/**
 * Effective feature map for a studio: { [featureKey]: boolean }.
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
    const global = platform.feature_global || {};
    const overrides = studio?.feature_overrides || {};

    const features = {};
    for (const key of FEATURE_KEYS) {
        if (global[key] === false) {
            features[key] = false;
            continue;
        }
        if (overrides[key] === true) {
            features[key] = true;
            continue;
        }
        if (overrides[key] === false) {
            features[key] = false;
            continue;
        }
        features[key] = planSet.has(key);
    }

    return {
        studio_id: studio?._id?.toString() || null,
        subscription_plan: plan,
        features,
        catalog: FEATURE_CATALOG,
        plan_features: [...planSet],
        overrides,
        global_disabled: Object.keys(global).filter((k) => global[k] === false),
    };
};

const isFeatureEnabled = async (studioId, featureKey) => {
    const data = await getEffectiveFeaturesForStudio(studioId);
    return Boolean(data.features[featureKey]);
};

module.exports = {
    getEffectiveFeaturesForStudio,
    isFeatureEnabled,
    FEATURE_CATALOG,
    FEATURE_KEYS,
};

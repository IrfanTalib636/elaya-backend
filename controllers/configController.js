const {
    getPlatformConfig,
    updatePlatformConfig,
    getPublicConfig,
    formatStudioConfig,
    updateStudioConfig,
} = require('../utils/configService');
const { getEffectiveFeaturesForStudio, FEATURE_CATALOG } = require('../utils/featureService');
const { isAdmin, isStudio } = require('../utils/accessHelpers');
const { USER_ROLES } = require('../config/constants');
const Studio = require('../models/studioModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const mongoose = require('mongoose');
const { runExcelPlausibilityCheck } = require('../utils/plausibilityCheck');
const { DOMAIN_SOURCE_OF_TRUTH } = require('../config/domainSourceOfTruth');

const assertValidStudioId = (studioId) => {
    if (
        !studioId ||
        !mongoose.Types.ObjectId.isValid(studioId) ||
        String(new mongoose.Types.ObjectId(studioId)) !== String(studioId)
    ) {
        throw new ApiError(
            400,
            'Invalid studioId. Use the Studio MongoDB ObjectId (24-char hex). Tip: GET /cases → copy the studio field from any case.'
        );
    }
};

const getPlatform = asyncHandler(async (_req, res) => {
    const config = await getPlatformConfig();

    res.status(200).json({
        success: true,
        data: {
            platform_config: config,
            excel_plausibility: runExcelPlausibilityCheck({
                session_prediction: config.session_prediction,
            }),
            domain_source_of_truth: DOMAIN_SOURCE_OF_TRUTH,
        },
    });
});

const patchPlatform = asyncHandler(async (req, res) => {
    const config = await updatePlatformConfig(req.body);

    res.status(200).json({
        success: true,
        message: 'Platform config updated',
        data: {
            platform_config: config,
            excel_plausibility: runExcelPlausibilityCheck({
                session_prediction: config.session_prediction,
            }),
        },
    });
});

const getPublic = asyncHandler(async (_req, res) => {
    const config = await getPublicConfig();

    res.status(200).json({
        success: true,
        data: { config },
    });
});

const resolveStudioForUser = async (user, studioIdParam) => {
    if (studioIdParam) {
        if (!isAdmin(user.role)) {
            throw new ApiError(403, 'Only admins can access config for other studios');
        }
        assertValidStudioId(studioIdParam);
        const studio = await Studio.findById(studioIdParam);
        if (!studio) {
            throw new ApiError(404, 'Studio not found');
        }
        return studio;
    }

    if (!isStudio(user.role) || !user.studio_id) {
        throw new ApiError(403, 'Studio account required');
    }

    const studio = await Studio.findById(user.studio_id);
    if (!studio) {
        throw new ApiError(404, 'Studio not found');
    }
    return studio;
};

const getStudioConfig = asyncHandler(async (req, res) => {
    const studio = await resolveStudioForUser(req.user, req.params.studioId);
    const platform = await getPlatformConfig();

    res.status(200).json({
        success: true,
        data: { studio_config: formatStudioConfig(studio, platform) },
    });
});

const patchStudioConfigHandler = asyncHandler(async (req, res) => {
    const studio = await resolveStudioForUser(req.user, req.params.studioId);

    if (!isAdmin(req.user.role) && req.user.role !== USER_ROLES.STUDIO_ADMIN) {
        throw new ApiError(403, 'Only studio admins can update studio config');
    }

    // Only admins may change subscription_plan / feature_overrides
    const patch = { ...req.body };
    if (!isAdmin(req.user.role)) {
        delete patch.subscription_plan;
        delete patch.feature_overrides;
    }

    const studioConfig = await updateStudioConfig(studio._id, patch);

    res.status(200).json({
        success: true,
        message: 'Studio config updated',
        data: { studio_config: studioConfig },
    });
});

/** GET /config/features/catalog */
const getFeatureCatalog = asyncHandler(async (_req, res) => {
    const platform = await getPlatformConfig();
    res.json({
        success: true,
        data: {
            catalog: FEATURE_CATALOG,
            subscription_plans: platform.subscription_plans,
            feature_global: platform.feature_global || {},
            shop_provision_prozent: platform.shop_provision_prozent,
            stripe_connect_enabled: Boolean(
                process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim()
            ),
        },
    });
});

/** GET /config/features/effective — customer/studio effective flags */
const getEffectiveFeatures = asyncHandler(async (req, res) => {
    let studioId = req.query.studio_id || null;
    if (isStudio(req.user.role) && req.user.studio_id) {
        studioId = req.user.studio_id;
    }
    if (req.user.role === USER_ROLES.CUSTOMER && req.user.customer_id && !studioId) {
        const Customer = require('../models/customerModel');
        const c = await Customer.findById(req.user.customer_id)
            .select('aktuelle_firma_id')
            .lean();
        studioId = c?.aktuelle_firma_id || null;
    }

    const data = await getEffectiveFeaturesForStudio(studioId);
    res.json({ success: true, data });
});

/** GET /config/features/studios — admin matrix of all studios */
const listStudioFeaturesAdmin = asyncHandler(async (_req, res) => {
    const studios = await Studio.find()
        .select('firma studio_code status subscription_plan feature_overrides')
        .sort({ firma: 1 })
        .lean();

    const rows = [];
    for (const s of studios) {
        const effective = await getEffectiveFeaturesForStudio(s);
        rows.push({
            studio_id: s._id,
            firma: s.firma,
            studio_code: s.studio_code,
            status: s.status,
            subscription_plan: effective.subscription_plan,
            features: effective.features,
            overrides: effective.overrides,
            plan_features: effective.plan_features,
        });
    }

    res.json({
        success: true,
        data: {
            catalog: FEATURE_CATALOG,
            studios: rows,
        },
    });
});

module.exports = {
    getPlatform,
    patchPlatform,
    getPublic,
    getStudioConfig,
    patchStudioConfigHandler,
    getFeatureCatalog,
    getEffectiveFeatures,
    listStudioFeaturesAdmin,
};

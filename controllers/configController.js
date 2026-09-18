const {
    getPlatformConfig,
    updatePlatformConfig,
    getPublicConfig,
    formatStudioConfig,
    updateStudioConfig,
    getEffectivePricingOverrides,
    mergeDefaultPricing,
    getConfigLifecycle,
    saveConfigDraft,
    discardConfigDraft,
    listConfigVersions,
    publishConfigDomain,
    rollbackConfigVersion,
    VERSIONED_CONFIG_DOMAINS,
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
const { previewSessionPrediction } = require('../utils/sessionPredictionEngine');
const { previewPricing } = require('../utils/pricingEngine');
const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
const { emitSessionPredictionUpdated } = require('../sockets/configEmit');
const { EXCEL_PLAUSIBILITY_EXAMPLES } = require('../config/excelPlausibilityExamples');

const assertSuperAdmin = (user) => {
    if (user?.role !== USER_ROLES.SUPER_ADMIN) {
        throw new ApiError(403, 'Only super admin can manage config drafts and publish');
    }
};

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
    const lifecycle = {};
    for (const domain of VERSIONED_CONFIG_DOMAINS) {
        lifecycle[domain] = await getConfigLifecycle(domain);
    }

    res.status(200).json({
        success: true,
        data: {
            platform_config: {
                ...config,
                pricing_defaults: mergeDefaultPricing(config),
            },
            config_lifecycle: lifecycle,
            excel_plausibility: runExcelPlausibilityCheck({
                session_prediction: config.session_prediction,
            }),
            domain_source_of_truth: DOMAIN_SOURCE_OF_TRUTH,
        },
    });
});

const patchPlatform = asyncHandler(async (req, res) => {
    // Core medical / pricing / prediction rules are super-admin only.
    const superAdminOnlyKeys = [
        'session_prediction',
        'default_pricing',
        'sperrfristen',
    ];
    const touchesSuperAdminOnly = superAdminOnlyKeys.some(
        (key) => req.body[key] !== undefined
    );
    if (touchesSuperAdminOnly && req.user.role !== USER_ROLES.SUPER_ADMIN) {
        throw new ApiError(
            403,
            'Only super admin can update medical lockouts, price calculation, or session prediction'
        );
    }

    // Versioned domains must go through draft → publish (or explicit publish reason).
    const versionedTouched = VERSIONED_CONFIG_DOMAINS.filter(
        (key) => req.body[key] !== undefined
    );
    if (versionedTouched.length > 1) {
        throw new ApiError(
            400,
            'Publish one versioned domain at a time (sperrfristen, default_pricing, or session_prediction)'
        );
    }
    if (versionedTouched.length === 1) {
        const domain = versionedTouched[0];
        const otherKeys = Object.keys(req.body).filter(
            (k) =>
                k !== domain &&
                k !== 'reason' &&
                k !== 'audit_reason' &&
                req.body[k] !== undefined
        );
        if (otherKeys.length) {
            throw new ApiError(
                400,
                `Cannot mix ${domain} with other fields in one patch (${otherKeys.join(', ')}). Publish versioned domains separately.`
            );
        }
        const reason =
            req.body.audit_reason ||
            req.body.reason ||
            'Published via platform config patch';
        const result = await publishConfigDomain(domain, {
            userId: req.user._id || req.user.id,
            reason,
            data: req.body[domain],
        });

        if (domain === 'session_prediction') {
            emitSessionPredictionUpdated({
                session_prediction: result.published,
                previous_base_sessions: result.before?.base_sessions ?? null,
                base_sessions: result.published?.base_sessions ?? null,
            });
        }

        const {
            logPlatformAudit,
            PLATFORM_AUDIT_ACTION,
        } = require('../services/platformAuditService');
        void logPlatformAudit({
            actor: req.user,
            action: PLATFORM_AUDIT_ACTION.CONFIG_PUBLISH,
            targetType: 'platform',
            targetId: `config:${domain}:v${result.version}`,
            reason,
            before: { [domain]: result.before },
            after: { [domain]: result.published },
            meta: { keys: [domain], version: result.version, via: 'patch' },
            ip: req.ip,
        });

        return res.status(200).json({
            success: true,
            message: `Platform config published (${domain} v${result.version})`,
            data: {
                platform_config: {
                    ...result.platform_config,
                    pricing_defaults: mergeDefaultPricing(result.platform_config),
                },
                version: result.version,
                domain,
                excel_plausibility: runExcelPlausibilityCheck({
                    session_prediction: result.platform_config.session_prediction,
                }),
            },
        });
    }

    const before = await getPlatformConfig();
    const config = await updatePlatformConfig(req.body);

    if (req.body.session_prediction !== undefined) {
        emitSessionPredictionUpdated({
            session_prediction: config.session_prediction,
            previous_base_sessions: before.session_prediction?.base_sessions ?? null,
            base_sessions: config.session_prediction?.base_sessions ?? null,
        });
    }

    if (touchesSuperAdminOnly) {
        const {
            logPlatformAudit,
            PLATFORM_AUDIT_ACTION,
        } = require('../services/platformAuditService');
        const changedKeys = superAdminOnlyKeys.filter((k) => req.body[k] !== undefined);
        const beforeSlice = {};
        const afterSlice = {};
        for (const key of changedKeys) {
            beforeSlice[key] = before[key] ?? null;
            afterSlice[key] = config[key] ?? null;
        }
        void logPlatformAudit({
            actor: req.user,
            action: req.body.sperrfristen
                ? PLATFORM_AUDIT_ACTION.SPERRFRISTEN_PATCH
                : PLATFORM_AUDIT_ACTION.PLATFORM_CONFIG_PATCH,
            targetType: 'platform',
            targetId: 'platform_config',
            reason: req.body.audit_reason || req.body.reason || '',
            before: beforeSlice,
            after: afterSlice,
            meta: { keys: changedKeys },
            ip: req.ip,
        });
    }

    res.status(200).json({
        success: true,
        message: 'Platform config updated',
        data: {
            platform_config: {
                ...config,
                pricing_defaults: mergeDefaultPricing(config),
            },
            excel_plausibility: runExcelPlausibilityCheck({
                session_prediction: config.session_prediction,
            }),
        },
    });
});

const getPublic = asyncHandler(async (req, res) => {
    let studioId = req.user?.studio_id || null;
    if (!studioId && req.user?.role === USER_ROLES.CUSTOMER && req.user.customer_id) {
        const Customer = require('../models/customerModel');
        const customer = await Customer.findById(req.user.customer_id)
            .select('aktuelle_firma_id')
            .lean();
        studioId = customer?.aktuelle_firma_id || null;
    }
    const config = await getPublicConfig(studioId);

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
        // Price calculation rules are platform-owned — studios view only.
        if (patch.studio_pricing !== undefined) {
            throw new ApiError(403, 'Only super admin can change price calculation rules');
        }
        // Medical lockouts are platform-owned — studios view only.
        if (patch.sperrfristen !== undefined) {
            throw new ApiError(
                403,
                'Only super admin can change medical lockout (Sperrfristen) rules'
            );
        }
    } else if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
        if (patch.studio_pricing !== undefined) {
            throw new ApiError(403, 'Only super admin can change price calculation rules');
        }
        if (patch.sperrfristen !== undefined) {
            throw new ApiError(
                403,
                'Only super admin can change medical lockout (Sperrfristen) rules'
            );
        }
    }

    const beforeCfg = await formatStudioConfig(studio, await getPlatformConfig());
    const studioConfig = await updateStudioConfig(studio._id, patch);

    if (patch.sperrfristen !== undefined || patch.studio_pricing !== undefined) {
        const {
            logPlatformAudit,
            PLATFORM_AUDIT_ACTION,
        } = require('../services/platformAuditService');
        void logPlatformAudit({
            actor: req.user,
            action: patch.sperrfristen
                ? PLATFORM_AUDIT_ACTION.SPERRFRISTEN_PATCH
                : PLATFORM_AUDIT_ACTION.STUDIO_CONFIG_PATCH,
            targetType: 'studio',
            targetId: String(studio._id),
            studioId: studio._id,
            reason: req.body.audit_reason || req.body.reason || '',
            before: {
                sperrfristen: beforeCfg.sperrfristen,
                studio_pricing: beforeCfg.studio_pricing,
            },
            after: {
                sperrfristen: studioConfig.sperrfristen,
                studio_pricing: studioConfig.studio_pricing,
            },
            meta: {
                keys: Object.keys(patch).filter((k) =>
                    ['sperrfristen', 'studio_pricing'].includes(k)
                ),
            },
            ip: req.ip,
        });
    }

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
            subscription_seat_limits: platform.subscription_seat_limits,
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

/**
 * POST /config/session-prediction/preview
 * Live Sitzungsprognose calculator — uses the real engine, never persists.
 * Admin/studio can pass draft session_prediction to see effect before save.
 */
const previewSessionPredictionHandler = asyncHandler(async (req, res) => {
    const platform = await getPlatformConfig();
    const baselinePrediction = platform.session_prediction;
    const draftPrediction = mergeSessionPrediction({
        ...baselinePrediction,
        ...(req.body.session_prediction || {}),
        tattoo_deltas: {
            ...(baselinePrediction?.tattoo_deltas || {}),
            ...(req.body.session_prediction?.tattoo_deltas || {}),
        },
        lifestyle_scores: {
            ...(baselinePrediction?.lifestyle_scores || {}),
            ...(req.body.session_prediction?.lifestyle_scores || {}),
        },
        aftercare_extra_max: {
            ...(baselinePrediction?.aftercare_extra_max || {}),
            ...(req.body.session_prediction?.aftercare_extra_max || {}),
        },
    });

    const presets = Object.fromEntries(
        EXCEL_PLAUSIBILITY_EXAMPLES.map((ex) => [ex.id, { title: ex.title, input: ex.input }])
    );

    let caseInput = req.body.case_input || {};
    if (req.body.preset_id && presets[req.body.preset_id]) {
        caseInput = { ...presets[req.body.preset_id].input, ...caseInput };
    }
    if (!Object.keys(caseInput).length) {
        caseInput = { ...presets.example_1.input };
    }

    const preview = previewSessionPrediction(caseInput, draftPrediction, {
        baselinePrediction,
    });

    res.status(200).json({
        success: true,
        data: {
            ...preview,
            presets: EXCEL_PLAUSIBILITY_EXAMPLES.map((ex) => ({
                id: ex.id,
                title: ex.title,
                expected_sessions: {
                    min: ex.expected.sessions_min,
                    max: ex.expected.sessions_max,
                },
            })),
            saved_session_prediction: baselinePrediction,
        },
    });
});

/**
 * POST /config/pricing/preview
 * Live price calculator for the pricing settings — uses the real engine, never
 * persists. The studio's unsaved `studio_pricing` values are merged over the
 * saved ones so the effect of an edit is visible before saving.
 */
const previewPricingHandler = asyncHandler(async (req, res) => {
    // Admins may preview another studio; a studio user is pinned to its own.
    const studioId = isStudio(req.user.role)
        ? req.user.studio_id
        : req.body.studio_id || req.user.studio_id || null;

    const baselinePricing = await getEffectivePricingOverrides(studioId);
    const draftPricing = { ...baselinePricing, ...(req.body.studio_pricing || {}) };

    const presets = Object.fromEntries(
        EXCEL_PLAUSIBILITY_EXAMPLES.map((ex) => [ex.id, { title: ex.title, input: ex.input }])
    );

    let caseInput = req.body.case_input || {};
    if (req.body.preset_id && presets[req.body.preset_id]) {
        caseInput = { ...presets[req.body.preset_id].input, ...caseInput };
    }
    if (!Object.keys(caseInput).length) {
        caseInput = { ...presets.example_1.input };
    }

    const preview = previewPricing(caseInput, draftPricing, { baselinePricing });

    res.status(200).json({
        success: true,
        data: {
            ...preview,
            presets: EXCEL_PLAUSIBILITY_EXAMPLES.map((ex) => ({
                id: ex.id,
                title: ex.title,
                area: ex.expected?.area ?? null,
                reference_price: ex.expected?.price_per_session ?? null,
            })),
        },
    });
});

const getConfigDomainLifecycle = asyncHandler(async (req, res) => {
    const lifecycle = await getConfigLifecycle(req.params.domain);
    res.status(200).json({ success: true, data: lifecycle });
});

const putConfigDomainDraft = asyncHandler(async (req, res) => {
    assertSuperAdmin(req.user);
    const domain = req.params.domain;
    const lifecycle = await saveConfigDraft(domain, req.body.data, {
        userId: req.user._id || req.user.id,
        note: req.body.note || '',
    });

    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.CONFIG_DRAFT_SAVE,
        targetType: 'platform',
        targetId: `config_draft:${domain}`,
        reason: req.body.note || '',
        before: null,
        after: lifecycle.draft?.data ?? null,
        meta: { domain },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: 'Draft saved',
        data: lifecycle,
    });
});

const deleteConfigDomainDraft = asyncHandler(async (req, res) => {
    assertSuperAdmin(req.user);
    const domain = req.params.domain;
    const before = await getConfigLifecycle(domain);
    const lifecycle = await discardConfigDraft(domain);

    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.CONFIG_DRAFT_DISCARD,
        targetType: 'platform',
        targetId: `config_draft:${domain}`,
        reason: req.body?.reason || '',
        before: before.draft?.data ?? null,
        after: null,
        meta: { domain },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: 'Draft discarded',
        data: lifecycle,
    });
});

const publishConfigDomainHandler = asyncHandler(async (req, res) => {
    assertSuperAdmin(req.user);
    const domain = req.params.domain;
    const result = await publishConfigDomain(domain, {
        userId: req.user._id || req.user.id,
        reason: req.body.reason,
        data: req.body.data,
    });

    if (domain === 'session_prediction') {
        emitSessionPredictionUpdated({
            session_prediction: result.published,
            previous_base_sessions: result.before?.base_sessions ?? null,
            base_sessions: result.published?.base_sessions ?? null,
        });
    }

    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.CONFIG_PUBLISH,
        targetType: 'platform',
        targetId: `config:${domain}:v${result.version}`,
        reason: req.body.reason || '',
        before: result.before,
        after: result.published,
        meta: {
            domain,
            version: result.version,
            rolled_back_from: result.rolled_back_from,
        },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: `Published ${domain} as version ${result.version}`,
        data: {
            ...result,
            platform_config: {
                ...result.platform_config,
                pricing_defaults: mergeDefaultPricing(result.platform_config),
            },
            excel_plausibility: runExcelPlausibilityCheck({
                session_prediction: result.platform_config.session_prediction,
            }),
        },
    });
});

const listConfigDomainVersions = asyncHandler(async (req, res) => {
    const versions = await listConfigVersions(req.params.domain, {
        limit: req.query.limit,
    });
    const lifecycle = await getConfigLifecycle(req.params.domain);
    res.status(200).json({
        success: true,
        data: {
            domain: req.params.domain,
            current_version: lifecycle.current_version,
            has_draft: lifecycle.has_draft,
            versions,
        },
    });
});

const rollbackConfigDomainHandler = asyncHandler(async (req, res) => {
    assertSuperAdmin(req.user);
    const domain = req.params.domain;
    const version = Number(req.params.version);
    const result = await rollbackConfigVersion(domain, version, {
        userId: req.user._id || req.user.id,
        reason: req.body.reason,
    });

    if (domain === 'session_prediction') {
        emitSessionPredictionUpdated({
            session_prediction: result.published,
            previous_base_sessions: result.before?.base_sessions ?? null,
            base_sessions: result.published?.base_sessions ?? null,
        });
    }

    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.CONFIG_ROLLBACK,
        targetType: 'platform',
        targetId: `config:${domain}:v${result.version}`,
        reason: req.body.reason || '',
        before: result.before,
        after: result.published,
        meta: {
            domain,
            version: result.version,
            rolled_back_from: version,
        },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: `Rolled back ${domain} to version ${version} (published as v${result.version})`,
        data: {
            ...result,
            platform_config: {
                ...result.platform_config,
                pricing_defaults: mergeDefaultPricing(result.platform_config),
            },
            excel_plausibility: runExcelPlausibilityCheck({
                session_prediction: result.platform_config.session_prediction,
            }),
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
    previewSessionPredictionHandler,
    previewPricingHandler,
    getConfigDomainLifecycle,
    putConfigDomainDraft,
    deleteConfigDomainDraft,
    publishConfigDomainHandler,
    listConfigDomainVersions,
    rollbackConfigDomainHandler,
};

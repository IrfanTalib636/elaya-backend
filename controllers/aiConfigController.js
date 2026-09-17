const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { getAiConfig, updateAiConfig } = require('../utils/aiConfigService');
const { ADMIN_PERMISSIONS } = require('../config/adminPermissions');
const { hasPermission } = require('../middleware/authMiddleware');

const getAiConfigHandler = asyncHandler(async (req, res) => {
    if (!hasPermission(req.user, ADMIN_PERMISSIONS.MANAGE_AI_CONFIG)) {
        throw new ApiError(403, 'Missing manage_ai_config permission');
    }
    const config = await getAiConfig();
    res.status(200).json({ success: true, data: { ai_config: config } });
});

const patchAiConfigHandler = asyncHandler(async (req, res) => {
    if (!hasPermission(req.user, ADMIN_PERMISSIONS.MANAGE_AI_CONFIG)) {
        throw new ApiError(403, 'Missing manage_ai_config permission');
    }
    const before = await getAiConfig();
    const config = await updateAiConfig(req.body, req.user._id || req.user.id);

    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.AI_CONFIG_UPDATE,
        targetType: 'platform',
        targetId: 'ai_config',
        reason: req.body.reason || '',
        before: {
            model_name: before.model_name,
            prompt_keys: Object.keys(before.prompts || {}),
        },
        after: {
            model_name: config.model_name,
            prompt_keys: Object.keys(config.prompts || {}),
        },
        meta: {
            updated_prompt_keys: req.body.prompts
                ? Object.keys(req.body.prompts).filter((k) => req.body.prompts[k] !== undefined)
                : [],
        },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: 'AI config updated',
        data: { ai_config: config },
    });
});

module.exports = {
    getAiConfigHandler,
    patchAiConfigHandler,
};

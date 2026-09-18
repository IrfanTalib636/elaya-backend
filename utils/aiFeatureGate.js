const ApiError = require('./ApiError');
const { isFeatureEnabled } = require('./featureService');
const { isAiEnabled } = require('../services/anthropicService');
const { USER_ROLES } = require('../config/constants');

/**
 * Gate AI routes: Anthropic key must be configured, and the studio's
 * effective feature flag (or platform for admin) must allow the feature.
 *
 * For customers: uses their current studio_id.
 * For studio users: uses their studio_id.
 * For admins: only requires Anthropic to be enabled (platform tooling).
 */
const assertAiFeatureAllowed = async (user, featureKey) => {
    if (!isAiEnabled()) {
        return { allowed: false, reason: 'ai_disabled' };
    }

    const role = user?.role;
    if (
        role === USER_ROLES.ADMIN ||
        role === USER_ROLES.SUPER_ADMIN ||
        role === USER_ROLES.DEVELOPER
    ) {
        return { allowed: true, reason: null };
    }

    const studioId = user?.studio_id || null;
    if (!studioId && role === USER_ROLES.CUSTOMER) {
        // Customer without studio — still allow if Anthropic is on; feature
        // resolution falls back to professional plan defaults.
        const ok = await isFeatureEnabled(null, featureKey);
        return { allowed: ok, reason: ok ? null : 'feature_disabled' };
    }

    const ok = await isFeatureEnabled(studioId, featureKey);
    return { allowed: ok, reason: ok ? null : 'feature_disabled' };
};

const requireAiFeature = async (user, featureKey) => {
    const result = await assertAiFeatureAllowed(user, featureKey);
    if (!result.allowed && result.reason === 'feature_disabled') {
        throw new ApiError(403, `Feature ${featureKey} is disabled for this studio`);
    }
    return result;
};

module.exports = {
    assertAiFeatureAllowed,
    requireAiFeature,
};

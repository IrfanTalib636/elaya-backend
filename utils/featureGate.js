const asyncHandler = require('./asyncHandler');
const ApiError = require('./ApiError');
const { USER_ROLES } = require('../config/constants');
const { isFeatureEnabled } = require('./featureService');

/**
 * Resolve which studio_id to check for the current request.
 * Admins / developers bypass feature gates (platform tooling).
 */
const resolveStudioIdForFeatureGate = (req) => {
    const role = req.user?.role;
    if (
        role === USER_ROLES.ADMIN ||
        role === USER_ROLES.SUPER_ADMIN ||
        role === USER_ROLES.DEVELOPER
    ) {
        return null; // bypass
    }
    if (role === USER_ROLES.CUSTOMER) {
        return req.user?.studio_id || null;
    }
    return req.user?.studio_id || null;
};

/**
 * Express middleware: require one (or any of several) feature flags for the studio.
 * Usage: requireFeature('elayshop') or requireFeature(['case_basic', 'case_zonen'], { mode: 'any' })
 *
 * @param {string|string[]} featureKey
 * @param {{ mode?: 'all'|'any', optionalStudio?: boolean }} [opts]
 *   optionalStudio: if true and no studio_id, allow (customer not yet assigned)
 */
const requireFeature = (featureKey, opts = {}) => {
    const keys = Array.isArray(featureKey) ? featureKey : [featureKey];
    const mode = opts.mode === 'any' ? 'any' : 'all';
    const optionalStudio = Boolean(opts.optionalStudio);

    return asyncHandler(async (req, _res, next) => {
        const role = req.user?.role;
        if (
            role === USER_ROLES.ADMIN ||
            role === USER_ROLES.SUPER_ADMIN ||
            role === USER_ROLES.DEVELOPER
        ) {
            return next();
        }

        const studioId = resolveStudioIdForFeatureGate(req);
        if (!studioId) {
            if (optionalStudio || role === USER_ROLES.CUSTOMER) {
                // Resolve against plan defaults (null studio → professional defaults in service)
                const results = await Promise.all(keys.map((k) => isFeatureEnabled(null, k)));
                const ok = mode === 'any' ? results.some(Boolean) : results.every(Boolean);
                if (!ok) {
                    throw new ApiError(
                        403,
                        `Feature ${keys.join(' / ')} is disabled for this studio`
                    );
                }
                return next();
            }
            throw new ApiError(403, `Feature ${keys.join(' / ')} is disabled for this studio`);
        }

        const results = await Promise.all(keys.map((k) => isFeatureEnabled(studioId, k)));
        const ok = mode === 'any' ? results.some(Boolean) : results.every(Boolean);
        if (!ok) {
            throw new ApiError(403, `Feature ${keys.join(' / ')} is disabled for this studio`);
        }
        return next();
    });
};

module.exports = {
    requireFeature,
    resolveStudioIdForFeatureGate,
};

const User = require('../models/userModel');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/generateTokenAndSetCookies');
const asyncHandler = require('../utils/asyncHandler');
const { USER_STATUS, USER_ROLES } = require('../config/constants');
const {
    ADMIN_PERMISSION_LIST,
} = require('../config/adminPermissions');

const protect = asyncHandler(async (req, _res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new ApiError(401, 'Not authorized — access token required');
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
        throw new ApiError(401, 'User no longer exists');
    }

    if (user.status === USER_STATUS.GESPERRT) {
        throw new ApiError(403, 'Account is locked');
    }

    if (user.status === USER_STATUS.AUSSTEHEND) {
        throw new ApiError(403, 'Account pending approval');
    }

    req.user = user;
    next();
});

const authorize = (...roles) => (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        throw new ApiError(403, 'You do not have permission for this action');
    }
    next();
};

const {
    studioUserHasPermission,
    STUDIO_PERMISSIONS,
} = require('../config/studioAccountRoles');

/**
 * Studio login permission gate. Admins/super_admins bypass.
 */
const requireStudioPermission =
    (...permissionKeys) =>
    (req, _res, next) => {
        if (!req.user) throw new ApiError(401, 'Not authorized');
        if (
            req.user.role === USER_ROLES.ADMIN ||
            req.user.role === USER_ROLES.SUPER_ADMIN ||
            req.user.role === USER_ROLES.DEVELOPER
        ) {
            return next();
        }
        const ok = permissionKeys.some((key) => studioUserHasPermission(req.user, key));
        if (!ok) {
            throw new ApiError(403, 'Missing required studio permission');
        }
        return next();
    };

const isSuperAdminLike = (user) =>
    user?.role === USER_ROLES.SUPER_ADMIN || user?.role === USER_ROLES.DEVELOPER;

/**
 * Permission gate for admin APIs.
 * Super admin / developer: all permissions.
 * Admin: must have the key in user.permissions[].
 */
const requirePermission =
    (...permissionKeys) =>
    (req, _res, next) => {
        if (!req.user) {
            throw new ApiError(401, 'Not authorized');
        }
        if (isSuperAdminLike(req.user)) {
            return next();
        }
        if (req.user.role !== USER_ROLES.ADMIN) {
            throw new ApiError(403, 'Admin role required');
        }
        const granted = Array.isArray(req.user.permissions) ? req.user.permissions : [];
        const ok = permissionKeys.some((key) => granted.includes(key));
        if (!ok) {
            throw new ApiError(403, 'Missing required admin permission');
        }
        return next();
    };

const hasPermission = (user, permissionKey) => {
    if (!user) return false;
    if (isSuperAdminLike(user)) return true;
    if (user.role !== USER_ROLES.ADMIN) return false;
    if (!ADMIN_PERMISSION_LIST.includes(permissionKey)) return false;
    return Array.isArray(user.permissions) && user.permissions.includes(permissionKey);
};

module.exports = {
    protect,
    authorize,
    requirePermission,
    requireStudioPermission,
    hasPermission,
    isSuperAdminLike,
    STUDIO_PERMISSIONS,
};

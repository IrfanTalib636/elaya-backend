const { USER_ROLES } = require('../config/constants');
const ApiError = require('./ApiError');

const STUDIO_ROLES = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

/** ObjectId or populated doc → hex string */
const refId = (ref) => {
    if (!ref) return null;
    if (typeof ref === 'string') return ref;
    if (ref._id) return ref._id.toString();
    return ref.toString();
};

const isCustomer = (role) => role === USER_ROLES.CUSTOMER;
const isStudio = (role) => STUDIO_ROLES.includes(role);
const isAdmin = (role) => ADMIN_ROLES.includes(role);
const canManageSessions = (role) => isStudio(role) || isAdmin(role);

const assertCaseAccess = (user, caseDoc) => {
    if (isAdmin(user.role)) {
        return;
    }

    if (isCustomer(user.role)) {
        if (refId(caseDoc.customer) !== refId(user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this case');
        }
        return;
    }

    if (isStudio(user.role)) {
        if (refId(caseDoc.studio) !== refId(user.studio_id)) {
            throw new ApiError(403, 'You do not have access to this case');
        }
        return;
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const assertSessionAccess = (user, session) => {
    if (isAdmin(user.role)) {
        return;
    }

    if (isCustomer(user.role)) {
        if (refId(session.customer) !== refId(user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this session');
        }
        return;
    }

    if (isStudio(user.role)) {
        if (refId(session.studio) !== refId(user.studio_id)) {
            throw new ApiError(403, 'You do not have access to this session');
        }
        return;
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const buildScopedFilter = (user, baseFilter = {}) => {
    const filter = { ...baseFilter };

    if (isCustomer(user.role)) {
        filter.customer = user.customer_id;
    } else if (isStudio(user.role)) {
        filter.studio = user.studio_id;
    } else if (!isAdmin(user.role)) {
        throw new ApiError(403, 'You do not have permission for this action');
    }

    return filter;
};

module.exports = {
    isCustomer,
    isStudio,
    isAdmin,
    canManageSessions,
    assertCaseAccess,
    assertSessionAccess,
    buildScopedFilter,
};

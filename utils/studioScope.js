const ApiError = require('./ApiError');
const { isStudio, isAdmin } = require('./accessHelpers');

/** Resolve studio scope from JWT (studio user) or ?studio_id (admin). */
const resolveStudioId = (req) => {
    if (!isStudio(req.user.role) && !isAdmin(req.user.role)) {
        throw new ApiError(403, 'Studio access required');
    }
    const studioId = isAdmin(req.user.role) ? req.query.studio_id : req.user.studio_id;
    if (!studioId) {
        throw new ApiError(400, 'studio_id is required');
    }
    return studioId;
};

module.exports = { resolveStudioId };

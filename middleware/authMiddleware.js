const User = require('../models/userModel');
const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/generateTokenAndSetCookies');
const asyncHandler = require('../utils/asyncHandler');
const { USER_STATUS } = require('../config/constants');

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

module.exports = {
    protect,
    authorize,
};

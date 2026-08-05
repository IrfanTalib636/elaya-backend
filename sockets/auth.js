const User = require('../models/userModel');
const { verifyAccessToken } = require('../utils/generateTokenAndSetCookies');
const { USER_STATUS } = require('../config/constants');

/**
 * Socket.io auth — mirrors Express `protect`.
 * Client: `io(url, { auth: { token: accessJwt } })`
 * Also accepts `Authorization: Bearer …` handshake header.
 */
const socketAuthMiddleware = async (socket, next) => {
    try {
        const header = socket.handshake.headers?.authorization;
        const fromHeader =
            typeof header === 'string' && header.startsWith('Bearer ')
                ? header.slice(7).trim()
                : null;
        const token =
            socket.handshake.auth?.token ||
            socket.handshake.query?.token ||
            fromHeader;

        if (!token || typeof token !== 'string') {
            return next(new Error('Not authorized — access token required'));
        }

        const decoded = verifyAccessToken(token);
        const user = await User.findById(decoded.userId).select('-password');

        if (!user) {
            return next(new Error('User no longer exists'));
        }
        if (user.status === USER_STATUS.GESPERRT) {
            return next(new Error('Account is locked'));
        }
        if (user.status === USER_STATUS.AUSSTEHEND) {
            return next(new Error('Account pending approval'));
        }

        socket.user = user;
        return next();
    } catch (err) {
        return next(new Error(err.message || 'Not authorized'));
    }
};

module.exports = {
    socketAuthMiddleware,
};

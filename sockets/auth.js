const User = require('../models/userModel');
const Studio = require('../models/studioModel');
const { verifyAccessToken } = require('../utils/generateTokenAndSetCookies');
const { USER_STATUS, USER_ROLES } = require('../config/constants');
const { STUDIO_ACCOUNT_ROLES } = require('../config/studioAccountRoles');

const ADMIN_LIKE_ROLES = [
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.DEVELOPER,
];

/**
 * Socket.io auth — mirrors Express `protect`, including admin → studio
 * workspace tokens (`actingAsStudio` / `actingStudioId`) so the socket joins
 * the correct studio inbox room for live chat notifications.
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

        if (decoded.actingAsStudio && decoded.actingStudioId) {
            if (!ADMIN_LIKE_ROLES.includes(user.role)) {
                return next(
                    new Error('Only Elaya admins can use a studio workspace token')
                );
            }

            const studio = await Studio.findById(decoded.actingStudioId)
                .select('_id firma studio_code status')
                .lean();
            if (!studio) {
                return next(new Error('Studio not found for workspace session'));
            }
            if (studio.status === 'gesperrt' || studio.status === 'locked') {
                return next(new Error('Studio is locked'));
            }

            const base = typeof user.toObject === 'function' ? user.toObject() : { ...user };
            socket.user = {
                ...base,
                role: USER_ROLES.STUDIO_ADMIN,
                studio_id: studio._id,
                studio_account_role: STUDIO_ACCOUNT_ROLES.OWNER,
                _impersonation: {
                    active: true,
                    admin_id: user._id,
                    admin_role: user.role,
                    admin_email: user.email,
                    studio_id: studio._id,
                    studio_firma: studio.firma || '',
                    studio_code: studio.studio_code || '',
                    edit_mode: decoded.editMode === true,
                    reason: decoded.reason || '',
                },
            };
            return next();
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

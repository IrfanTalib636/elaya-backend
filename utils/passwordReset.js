const crypto = require('crypto');
const PasswordResetToken = require('../models/passwordResetTokenModel');
const { USER_ROLES } = require('../config/constants');

const STUDIO_ROLES = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const roleMatchesPortal = (role, portal) => {
    if (portal === 'studio') {
        return STUDIO_ROLES.includes(role);
    }

    if (portal === 'admin') {
        return ADMIN_ROLES.includes(role);
    }

    if (portal === 'customer') {
        return role === USER_ROLES.CUSTOMER;
    }

    return true;
};

const createPasswordResetToken = async (userId) => {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await PasswordResetToken.deleteMany({ user: userId, used_at: null });

    await PasswordResetToken.create({
        user: userId,
        token_hash: PasswordResetToken.hashToken(rawToken),
        expires_at: expiresAt,
    });

    return rawToken;
};

const findValidPasswordResetToken = async (rawToken) => {
    const tokenHash = PasswordResetToken.hashToken(rawToken);
    const record = await PasswordResetToken.findOne({ token_hash: tokenHash });

    if (!record || !record.isValid()) {
        return null;
    }

    return record;
};

module.exports = {
    roleMatchesPortal,
    createPasswordResetToken,
    findValidPasswordResetToken,
};

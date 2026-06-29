const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/refreshTokenModel');

const getAccessSecret = () => {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) {
        throw new Error('JWT_ACCESS_SECRET is not defined');
    }
    return secret;
};

const getRefreshSecret = () => {
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) {
        throw new Error('JWT_REFRESH_SECRET is not defined');
    }
    return secret;
};

const generateAccessToken = (payload) =>
    jwt.sign(payload, getAccessSecret(), {
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    });

const signRefreshToken = (userId, tokenId) =>
    jwt.sign({ userId, tokenId }, getRefreshSecret(), {
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    });

const verifyAccessToken = (token) => jwt.verify(token, getAccessSecret());

const verifyRefreshToken = (token) => jwt.verify(token, getRefreshSecret());

const getRefreshCookieOptions = ({ maxAge } = {}) => ({
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
    path: '/api/v1/auth',
    ...(maxAge !== undefined ? { maxAge } : {}),
});

const setRefreshTokenCookie = (res, token) => {
    res.cookie('refreshToken', token, getRefreshCookieOptions({ maxAge: 7 * 24 * 60 * 60 * 1000 }));
};

const clearRefreshTokenCookie = (res) => {
    res.clearCookie('refreshToken', getRefreshCookieOptions());
};

const parseRefreshExpiryMs = (value) => {
    const match = /^(\d+)([dhms])$/.exec(value);
    if (!match) {
        return 7 * 24 * 60 * 60 * 1000;
    }

    const amount = Number(match[1]);
    const unit = match[2];

    const multipliers = {
        d: 24 * 60 * 60 * 1000,
        h: 60 * 60 * 1000,
        m: 60 * 1000,
        s: 1000,
    };

    return amount * multipliers[unit];
};

const buildAuthPayload = (user) => ({
    userId: user._id.toString(),
    role: user.role,
    studioId: user.studio_id ? user.studio_id.toString() : null,
    customerId: user.customer_id ? user.customer_id.toString() : null,
});

const issueAuthTokens = async ({ user, res, req }) => {
    const expiresMs = parseRefreshExpiryMs(process.env.JWT_REFRESH_EXPIRES_IN || '7d');

    const refreshRecord = new RefreshToken({
        user: user._id,
        expires_at: new Date(Date.now() + expiresMs),
        user_agent: req.headers['user-agent'] || '',
        ip_address: req.ip || '',
    });

    const refreshToken = signRefreshToken(user._id.toString(), refreshRecord._id.toString());
    refreshRecord.token_hash = RefreshToken.hashToken(refreshToken);
    await refreshRecord.save();

    setRefreshTokenCookie(res, refreshToken);

    return {
        accessToken: generateAccessToken(buildAuthPayload(user)),
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    };
};

const revokeRefreshToken = async (token) => {
    try {
        const decoded = verifyRefreshToken(token);
        const record = await RefreshToken.findById(decoded.tokenId);

        if (record && record.isValid()) {
            record.revoked_at = new Date();
            await record.save();
        }
    } catch {
        // Expired or malformed token — nothing to revoke
    }
};

const findValidRefreshToken = async (token) => {
    let decoded;

    try {
        decoded = verifyRefreshToken(token);
    } catch {
        return null;
    }

    const record = await RefreshToken.findById(decoded.tokenId);

    if (!record || !record.isValid()) {
        return null;
    }

    if (record.token_hash !== RefreshToken.hashToken(token)) {
        return null;
    }

    return { decoded, record };
};

module.exports = {
    verifyAccessToken,
    clearRefreshTokenCookie,
    issueAuthTokens,
    revokeRefreshToken,
    findValidRefreshToken,
};

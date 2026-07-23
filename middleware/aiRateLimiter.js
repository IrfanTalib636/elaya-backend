const rateLimit = require('express-rate-limit');

/** Rate limit for Anthropic-backed routes (photo analysis is expensive). */
const aiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: 'Too many AI requests. Please try again later.',
    },
});

module.exports = aiRateLimiter;

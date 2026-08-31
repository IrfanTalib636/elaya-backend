const ApiError = require('../utils/ApiError');

const errorMiddleware = (err, _req, res, _next) => {
    if (err instanceof ApiError) {
        return res.status(err.statusCode).json({
            success: false,
            message: err.message,
            ...(err.errors ? { errors: err.errors } : {}),
        });
    }

    // body-parser rejects unparseable or oversized payloads before any route
    // runs. Without this branch the client sees a 500 for its own bad request.
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({
            success: false,
            message: 'Invalid JSON body',
        });
    }

    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            success: false,
            message: 'Request body too large',
        });
    }

    if (err.name === 'ValidationError') {
        const errors = Object.values(err.errors).map((e) => ({
            field: e.path,
            message: e.message,
        }));

        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors,
        });
    }

    if (err.code === 11000) {
        const field = Object.keys(err.keyValue || {})[0] || 'field';
        return res.status(409).json({
            success: false,
            message: `${field} already exists`,
        });
    }

    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid or expired token',
        });
    }

    if (err.name === 'CastError') {
        return res.status(400).json({
            success: false,
            message: `Invalid ${err.path || 'ID'} format`,
        });
    }

    console.error(err);

    return res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
};

module.exports = errorMiddleware;

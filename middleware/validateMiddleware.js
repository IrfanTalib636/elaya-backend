const ApiError = require('../utils/ApiError');

const formatZodErrors = (zodError) =>
    zodError.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
    }));

const validateMiddleware =
    (schema, source = 'body') =>
    (req, _res, next) => {
        const result = schema.safeParse(req[source]);

        if (!result.success) {
            return next(new ApiError(400, 'Validation failed', formatZodErrors(result.error)));
        }

        // Express 5 keeps original query strings; assignment alone does not stick.
        if (source === 'query') {
            Object.defineProperty(req, 'query', {
                value: result.data,
                writable: true,
                configurable: true,
                enumerable: true,
            });
        } else {
            req[source] = result.data;
        }

        return next();
    };

module.exports = validateMiddleware;

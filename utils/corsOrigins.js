const DEFAULT_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:3002',
    'http://localhost:8081',
    'http://127.0.0.1:8081',
    'https://app.elaya.io',
    'https://inkderm.vercel.app',
];

const isNativeOrDevOrigin = (origin) => {
    if (!origin || origin === 'null') return true;
    if (/^exp:\/\//i.test(origin)) return true;
    if (/^file:\/\//i.test(origin)) return true;
    if (
        /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/i.test(
            origin
        )
    ) {
        return true;
    }
    return false;
};

const buildAllowList = () => {
    const configured = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    return [...new Set([...DEFAULT_ORIGINS, ...configured])];
};

const corsOriginChecker = (origin, callback) => {
    if (isNativeOrDevOrigin(origin)) {
        return callback(null, true);
    }
    if (buildAllowList().includes(origin)) {
        return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
};

module.exports = {
    corsOriginChecker,
    buildAllowList,
    isNativeOrDevOrigin,
};

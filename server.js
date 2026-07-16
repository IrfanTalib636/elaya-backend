const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const dotenv = require('dotenv');

dotenv.config();

const connectDB = require('./config/db');
const { ensureUploadRoot } = require('./services/fileStorageService');
const { setupSwagger, isSwaggerEnabled } = require('./config/swagger');
const apiRoutes = require('./routes');
const errorMiddleware = require('./middleware/errorMiddleware');

const app = express();

app.set('trust proxy', 1);
app.set('etag', false);

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:'],
            },
        },
    })
);
app.use(
    cors({
        origin: process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [
            'http://localhost:5173',
            'http://localhost:3000',
        ],
        credentials: true,
    })
);
app.use(compression());
// Signatures as JPEG base64 (~3–15 KB); optional merkblatt PDF may be larger
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '512kb' }));
app.use(cookieParser());
app.use((req, _res, next) => {
    if (req.body) {
        req.body = mongoSanitize.sanitize(req.body);
    }
    next();
});
app.use(hpp());

if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
}

setupSwagger(app);

app.use('/api/v1', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});
app.use('/api/v1', apiRoutes);

app.get('/', (_req, res) => {
    res.json({
        success: true,
        message: 'Elaya API is running',
        docs: isSwaggerEnabled() ? '/api/v1/docs' : null,
        spec: isSwaggerEnabled() ? '/api/v1/docs.json' : null,
    });
});

app.use(errorMiddleware);

const startServer = async () => {
    try {
        await connectDB();
        await ensureUploadRoot();

        const port = process.env.PORT || 4000;

        const server = app.listen(port, () => {
            console.log(`Server is running on http://localhost:${port}`);
            if (isSwaggerEnabled()) {
                console.log(`API docs: http://localhost:${port}/api/v1/docs`);
                console.log(`OpenAPI spec: http://localhost:${port}/api/v1/docs.json`);
            }
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.error(`Port ${port} is already in use. Stop the other process and restart.`);
            } else {
                console.error('Server error:', err.message);
            }
            process.exit(1);
        });
    } catch (error) {
        console.error('Failed to start server:', error.message);
        process.exit(1);
    }
};

startServer();

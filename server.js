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
const wellKnownRoute = require('./routes/wellKnownRoute');
const { sendAppleAppSiteAssociation } = wellKnownRoute;
const errorMiddleware = require('./middleware/errorMiddleware');
const path = require('path');

const app = express();

app.set('trust proxy', 1);
app.set('etag', false);

// Universal / App Links verification — mount before helmet so Content-Type stays application/json.
app.use('/.well-known', wellKnownRoute);
// Apple also checks the legacy root path (no file extension).
app.get('/apple-app-site-association', sendAppleAppSiteAssociation);
// Static copies under public/.well-known (CDN / nginx deploy option)
app.use(
    '/.well-known',
    express.static(path.join(__dirname, 'public', '.well-known'), {
        setHeaders: (res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=300');
        },
    })
);

// Fallback page when the mobile app is not installed (universal link opens in browser).
app.get('/reset-password', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const deepLink = token
        ? `elaya://reset-password?token=${encodeURIComponent(token)}`
        : 'elaya://reset-password';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Elaya – Reset password</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 48px auto; padding: 0 16px; color: #0a1628; }
    a.btn { display: inline-block; margin-top: 16px; padding: 12px 18px; background: #1d6fe8; color: #fff; text-decoration: none; border-radius: 10px; }
    code { word-break: break-all; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Reset your password</h1>
  <p>Open this link in the Elaya app to choose a new password.</p>
  <p><a class="btn" href="${deepLink}">Open Elaya app</a></p>
  ${token ? `<p>If the button does not work, paste this token in the app:</p><p><code>${token.replace(/[<>&]/g, '')}</code></p>` : ''}
</body>
</html>`);
});

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

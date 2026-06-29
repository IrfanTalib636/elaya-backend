const fs = require('fs');
const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const ROUTES_DIR = path.join(__dirname, '../routes');

const getRouteDocPaths = () =>
    fs
        .readdirSync(ROUTES_DIR)
        .filter((file) => file.endsWith('.js') && file !== 'index.js')
        .map((file) => path.join(ROUTES_DIR, file));

const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'Elaya Platform API',
        version: '1.0.0',
        description:
            'Shared REST API for the Elaya platform — Customer Web Portal, Studio Web Dashboard, Admin Dashboard, and future mobile apps.\n\n' +
            '### How to read access\n' +
            'Every protected endpoint description starts with:\n' +
            '- **Auth:** None | Bearer | HttpOnly refresh cookie\n' +
            '- **Who can call:** which roles may use the endpoint\n\n' +
            '### Roles\n' +
            '| Role | Who |\n' +
            '|------|-----|\n' +
            '| `customer` | Customer app user |\n' +
            '| `studio_admin` | Studio owner |\n' +
            '| `studio_staff` | Studio employee |\n' +
            '| `admin` | Platform admin |\n' +
            '| `super_admin` | Platform super admin |\n\n' +
            'Authorize in Swagger with `Bearer <accessToken>` from POST `/auth/login`.',
        contact: {
            name: 'Moro Concept Group GmbH',
        },
    },
    servers: [
        {
            url: '/api/v1',
            description: 'Current server (relative)',
        },
    ],
    components: {
        securitySchemes: {
            bearerAuth: {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT',
                description: 'Access token returned from login / refresh',
            },
        },
        schemas: {
            Error: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'Validation failed' },
                    errors: {
                        type: 'array',
                        items: { type: 'object' },
                    },
                },
            },
            HealthResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                    environment: { type: 'string', example: 'development' },
                },
            },
            GruppenGroessen: {
                type: 'object',
                properties: {
                    klein_max_cm2: { type: 'number', example: 50 },
                    mittelgross_max_cm2: { type: 'number', example: 150 },
                    max_punkte: { type: 'number', example: 4 },
                    gruppen_rabatt: { type: 'number', example: 0.15 },
                },
            },
            PlatformConfig: {
                type: 'object',
                properties: {
                    coinWert: { type: 'number', example: 0.1 },
                    minWert: { type: 'number', example: 0.05 },
                    maxWert: { type: 'number', example: 0.2 },
                    deckelProzent: { type: 'number', example: 20 },
                    verfallMonate: { type: 'number', example: 12 },
                    grundgebuehr: { type: 'number', example: 149 },
                    transaktionsProzent: { type: 'number', example: 3 },
                    zahlungszielTage: { type: 'number', example: 30 },
                    gruppen_groessen: { $ref: '#/components/schemas/GruppenGroessen' },
                },
            },
            PlatformConfigResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                        type: 'object',
                        properties: {
                            platform_config: { $ref: '#/components/schemas/PlatformConfig' },
                        },
                    },
                },
            },
            StudioConfig: {
                type: 'object',
                properties: {
                    studio_id: { type: 'string', example: '507f1f77bcf86cd799439011' },
                    studio_code: { type: 'string', example: 'INKFREE' },
                    firma: { type: 'string', example: 'inkFree' },
                    coin_wert: { type: 'number', example: 0.1 },
                    studio_pricing: { type: 'object', additionalProperties: { type: 'number' } },
                    elaycoin_studio_cfg: { type: 'object', additionalProperties: { type: 'object' } },
                    platform_limits: { $ref: '#/components/schemas/PlatformConfig' },
                },
            },
            StudioConfigResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                        type: 'object',
                        properties: {
                            studio_config: { $ref: '#/components/schemas/StudioConfig' },
                        },
                    },
                },
            },
            PatchStudioConfigBody: {
                type: 'object',
                properties: {
                    coin_wert: { type: 'number', example: 0.1 },
                    studio_pricing: {
                        type: 'object',
                        example: { basePricePerCm2: 3.5, minPrice: 90 },
                        additionalProperties: { type: 'number' },
                    },
                    elaycoin_studio_cfg: {
                        type: 'object',
                        example: {
                            termin_wahrgenommen: { coins: 120, aktiv: true },
                        },
                        additionalProperties: {
                            type: 'object',
                            properties: {
                                coins: { type: 'number' },
                                aktiv: { type: 'boolean' },
                            },
                        },
                    },
                },
            },
        },
    },
    tags: [
        { name: 'Health', description: 'Server health and readiness checks' },
        { name: 'Auth', description: 'Login, register, refresh token, logout' },
        { name: 'Cases', description: 'Tattoo/PMU cases — create, list, update' },
        { name: 'Appointments', description: 'Booking — consultation and treatment appointments' },
        { name: 'Sessions', description: 'Treatment session logs (sessions_log)' },
        { name: 'Elaycoins', description: 'Elaycoin balance, transactions, expiry' },
        { name: 'Config', description: 'Platform + studio feature flags (elaya_admin_config, studio_pricing)' },
    ],
};

const buildSwaggerSpec = () =>
    swaggerJsdoc({
        definition: swaggerDefinition,
        apis: getRouteDocPaths(),
    });

const isSwaggerEnabled = () =>
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true';

const SWAGGER_CUSTOM_CSS = `
.swagger-ui .topbar { display: none }
html, body { margin: 0; overflow-x: hidden; max-width: 100vw; }
.swagger-ui { max-width: 100%; box-sizing: border-box; }
.swagger-ui .wrapper { max-width: 100%; box-sizing: border-box; padding: 0 16px; }
.swagger-ui .information-container,
.swagger-ui .opblock-tag-section,
.swagger-ui .opblock,
.swagger-ui section.models { max-width: 100%; box-sizing: border-box; }
.swagger-ui .parameters-container table,
.swagger-ui .model-container table { max-width: 100%; overflow-x: auto; }
.swagger-ui .live-responses-table { display: table !important; width: 100%; table-layout: fixed; }
.swagger-ui .live-responses-table tbody { display: table-row-group !important; }
.swagger-ui .live-responses-table tr { display: table-row !important; }
.swagger-ui .live-responses-table td,
.swagger-ui .live-responses-table th { display: table-cell !important; vertical-align: top; }
.swagger-ui .responses-wrapper .response-col_status { width: 5em; }
.swagger-ui .responses-wrapper .response-col_description { width: auto; }
.swagger-ui .responses-wrapper pre.microlight,
.swagger-ui .responses-wrapper .highlight-code { display: block !important; min-height: 2em; max-width: 100%; overflow-x: auto; }
.swagger-ui .opblock-body pre,
.swagger-ui .model-box,
.swagger-ui textarea { max-width: 100%; overflow-x: auto; word-break: break-word; white-space: pre-wrap; }
.swagger-ui .opblock-summary-description,
.swagger-ui .markdown p { line-height: 1.6; }
.swagger-ui .opblock-description-wrapper .markdown p:first-child {
  padding: 6px 10px;
  margin-bottom: 8px;
  border-radius: 4px;
  background: rgba(59, 65, 81, 0.06);
  border-left: 3px solid #4990e2;
  font-size: 12px;
}
.swagger-ui .parameters-col_description input[type=text] { max-width: 100%; }
`.trim();

const setupSwagger = (app) => {
    if (!isSwaggerEnabled()) {
        return;
    }

    const swaggerSpec = buildSwaggerSpec();

    app.use(
        '/api/v1/docs',
        swaggerUi.serve,
        swaggerUi.setup(swaggerSpec, {
            customSiteTitle: 'Elaya API Documentation',
            customCss: SWAGGER_CUSTOM_CSS,
            swaggerOptions: {
                persistAuthorization: true,
                displayRequestDuration: true,
            },
        })
    );

    app.get('/api/v1/docs.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
};

module.exports = {
    setupSwagger,
    isSwaggerEnabled,
};

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
            PhotoStdIntake: {
                type: 'object',
                description: 'TC_06 photo quality checklist (optional until upload UI)',
                properties: {
                    photo_full_visible: { type: 'boolean' },
                    photo_good_light: { type: 'boolean' },
                    photo_focus: { type: 'boolean' },
                    photo_distance: { type: 'boolean' },
                    photo_no_filter: { type: 'boolean' },
                },
            },
            CaseZoneInput: {
                type: 'object',
                description: 'Zone row when zonen_aktiv is true (TC_02)',
                properties: {
                    zonen_id: { type: 'string', example: 'Z001' },
                    bezeichnung: { type: 'string', example: 'Unterarm aussen' },
                    koerperstelle: {
                        type: 'string',
                        enum: ['arm', 'leg', 'chest', 'back', 'shoulder', 'neck', 'face', 'abdomen', 'hip', 'hand', 'foot', 'other'],
                    },
                    farben: {
                        type: 'array',
                        items: { type: 'string' },
                        example: ['black', 'red'],
                    },
                    dichte: {
                        type: 'string',
                        enum: ['low', 'medium', 'high', 'very_high'],
                    },
                    laenge_cm: { type: 'number', example: 12, description: 'Required — measured by the customer' },
                    breite_cm: { type: 'number', example: 8, description: 'Required — measured by the customer' },
                    flaeche_cm2: {
                        type: 'number',
                        readOnly: true,
                        example: 96,
                        description: 'Derived server-side from laenge_cm x breite_cm',
                    },
                    preis: { type: 'number', readOnly: true, description: 'Per-zone estimate' },
                    sitzungen_geschaetzt_min: { type: 'number', readOnly: true },
                    sitzungen_geschaetzt_max: { type: 'number', readOnly: true },
                    foto_url: {
                        type: 'string',
                        description:
                            'FileAsset id of the zone intake photo. Upload to POST /files/staging with slot=zone, then send the returned id here; the server links it to the case. Fetch via GET /files/{id}/content.',
                    },
                },
            },
            CaseIntakeFields: {
                type: 'object',
                description: 'Prototype intake TC_01–TC_06 (+ optional TC_08–09). Full field list: docs/CUSTOMER-CASE-INTAKE-SPEC.md',
                properties: {
                    type: { type: 'string', enum: ['tattoo', 'pmu'], default: 'tattoo' },
                    tc_title: { type: 'string', example: 'Unterarm links Schriftzug' },
                    bodyLabel: { type: 'string', example: 'Arm' },
                    tc_body_location_main: {
                        type: 'string',
                        enum: ['arm', 'leg', 'chest', 'back', 'shoulder', 'neck', 'face', 'abdomen', 'hip', 'hand', 'foot', 'other'],
                    },
                    tc_body_location_detail: { type: 'string' },
                    tc_side: { type: 'string', enum: ['left', 'right', 'center'], nullable: true },
                    tc_age_bucket: {
                        type: 'string',
                        enum: ['under_1', 'age_1_3', 'age_4_7', 'age_8_15', 'over_15', 'unknown'],
                    },
                    tc_prior_treatment: { type: 'boolean', nullable: true },
                    tc_prior_treatment_count: { type: 'integer', minimum: 0, maximum: 99 },
                    tc_colors_present: { type: 'array', items: { type: 'string' }, example: ['black'] },
                    tc_density: { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
                    tc_saturation: { type: 'string', enum: ['low', 'medium', 'high', 'very_high'] },
                    tc_shading: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
                    tc_linework: { type: 'string', enum: ['fine', 'medium', 'bold', 'mixed'] },
                    tc_size_length: { type: 'number', example: 8 },
                    tc_size_width: { type: 'number', example: 5 },
                    tc_type: {
                        type: 'string',
                        enum: ['amateur', 'cosmetic', 'professional', 'coverup', 'mixed'],
                    },
                    tc_coverup: { type: 'string', enum: ['none', 'once', 'multiple', 'unknown'] },
                    skin_fitzpatrick_type: {
                        type: 'string',
                        enum: ['I', 'II', 'III', 'IV', 'V', 'VI', 'unsicher'],
                    },
                    skin_hyperpig_risk: { type: 'string', enum: ['low', 'medium', 'high', 'unsure'] },
                    skin_keloid_risk: { type: 'string', enum: ['low', 'medium', 'high', 'unsure'] },
                    skin_sun_zone: { type: 'string', enum: ['low', 'medium', 'high'] },
                    life_smoker: {
                        type: 'string',
                        enum: ['no', 'never', 'occasionally', 'occasional', 'daily_light', 'daily_heavy'],
                    },
                    life_cig_per_day: { type: 'integer', minimum: 0, maximum: 60 },
                    life_alcohol: {
                        type: 'string',
                        enum: ['never', 'rarely', 'moderate', 'frequent', '1-2x_week', '3-4x_week', '5+x_week'],
                    },
                    life_activity: { type: 'string', enum: ['low', 'light', 'medium', 'regular', 'high'] },
                    life_sport_freq: { type: 'string', enum: ['0', '1-2', '3-4', '5+'] },
                    life_sleep_hours: {
                        type: 'string',
                        enum: ['under_5', '<5', '5-6', '6-7', '7-8', '8+'],
                    },
                    life_sleep_quality: { type: 'string', enum: ['poor', 'fair', 'good', 'excellent'] },
                    life_stress: { type: 'string', enum: ['low', 'moderate', 'high', 'very_high'] },
                    life_height_cm: { type: 'number', example: 172 },
                    life_weight_kg: { type: 'number', example: 70 },
                    life_hydration: { type: 'string', enum: ['poor', 'fair', 'good', 'excellent'] },
                    life_nutrition: { type: 'string', enum: ['poor', 'fair', 'good', 'very_good', 'very_poor'] },
                    goal_target: {
                        type: 'string',
                        enum: ['full', 'full_removal', 'partial_fade', 'lightening_for_coverup'],
                        description: 'full_removal is normalized to full',
                    },
                    goal_notes: { type: 'string' },
                    photo_intake_main: { type: 'string', description: 'URL or ref — upload API TBD' },
                    photo_intake_detail: { type: 'string' },
                    photo_marker: { type: 'string' },
                    photo_std_intake: { $ref: '#/components/schemas/PhotoStdIntake' },
                    zonen_aktiv: { type: 'boolean', default: false },
                    zonen: {
                        type: 'array',
                        maxItems: 8,
                        items: { $ref: '#/components/schemas/CaseZoneInput' },
                    },
                },
            },
            CaseCreateBody: {
                allOf: [
                    { $ref: '#/components/schemas/CaseIntakeFields' },
                    {
                        type: 'object',
                        properties: {
                            customer_id: {
                                type: 'string',
                                description: 'Required when caller is studio_admin, studio_staff, admin, or super_admin',
                            },
                            status: {
                                type: 'string',
                                enum: ['pending', 'active', 'completed', 'loeschantrag_ausstehend'],
                            },
                        },
                    },
                ],
            },
            CasePricingPreviewBody: {
                allOf: [{ $ref: '#/components/schemas/CaseIntakeFields' }],
                description: 'Same intake payload as case create (without customer_id). Used by studio wizard step 7 and mobile KI screen.',
            },
            PricingSessionEstimate: {
                type: 'object',
                properties: {
                    min: { type: 'integer', example: 6 },
                    max: { type: 'integer', example: 10 },
                    base: { type: 'integer', example: 8 },
                    confidence_pct: { type: 'integer', example: 100 },
                },
            },
            PricingZoneRow: {
                type: 'object',
                properties: {
                    label: { type: 'string', example: 'Unterarm aussen' },
                    preis: { type: 'number', example: 205 },
                    area: { type: 'number', example: 150 },
                    sessions: { $ref: '#/components/schemas/PricingSessionEstimate' },
                },
            },
            CasePricingPreviewResponse: {
                type: 'object',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                        type: 'object',
                        properties: {
                            type: { type: 'string', enum: ['tattoo', 'pmu'] },
                            area: { type: 'number', nullable: true, example: 40 },
                            pricePerSession: { type: 'number', example: 205 },
                            confidence_pct: { type: 'integer', example: 100 },
                            currency: { type: 'string', example: 'CHF' },
                            sessions: { $ref: '#/components/schemas/PricingSessionEstimate' },
                            totalMin: { type: 'number', example: 1230 },
                            totalMax: { type: 'number', example: 2050 },
                            zonen: {
                                type: 'array',
                                nullable: true,
                                items: { $ref: '#/components/schemas/PricingZoneRow' },
                            },
                            multipliers: {
                                type: 'object',
                                nullable: true,
                                description: 'Studio/admin only — 7-factor breakdown',
                                properties: {
                                    color: { type: 'number' },
                                    depth: { type: 'number' },
                                    age: { type: 'number' },
                                    skin: { type: 'number' },
                                    location: { type: 'number' },
                                    layering: { type: 'number' },
                                    goal: { type: 'number' },
                                    bodyLocation: { type: 'string' },
                                },
                            },
                        },
                    },
                },
            },
            CasePricingResponse: {
                type: 'object',
                description: 'GET /cases/:id/pricing — same shape as preview; customer role gets AB estimate only',
                properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                        type: 'object',
                        properties: {
                            type: { type: 'string' },
                            area: { type: 'number', nullable: true },
                            pricePerSession: { type: 'number' },
                            priceFrom: { type: 'number', description: 'Customer-facing alias' },
                            confidence_pct: { type: 'integer' },
                            currency: { type: 'string' },
                            sessions: { $ref: '#/components/schemas/PricingSessionEstimate' },
                            sessionsMin: { type: 'integer' },
                            sessionsMax: { type: 'integer' },
                            totalMin: { type: 'number' },
                            totalMax: { type: 'number' },
                            zonen: {
                                type: 'array',
                                nullable: true,
                                items: { $ref: '#/components/schemas/PricingZoneRow' },
                            },
                            multipliers: { type: 'object', nullable: true },
                        },
                    },
                },
            },
        },
    },
    tags: [
        { name: 'Health', description: 'Server health and readiness checks' },
        { name: 'Auth', description: 'Login, register, refresh token, logout' },
        { name: 'Cases', description: 'Tattoo/PMU cases — 8-step intake, pricing preview, anamnesis' },
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

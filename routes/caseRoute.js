const express = require('express');
const caseController = require('../controllers/caseController');
const anamnesisController = require('../controllers/anamnesisController');
const validateMiddleware = require('../middleware/validateMiddleware');
const { protect, authorize } = require('../middleware/authMiddleware');
const { createCaseSchema, updateCaseSchema, previewCasePricingSchema, availabilityQuerySchema, listCasesQuerySchema } = require('../validators/caseValidator');
const { upsertAnamnesisSchema } = require('../validators/anamnesisValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const caseAccessRoles = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * /cases:
 *   post:
 *     summary: Create a tattoo or PMU case
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Customer creates for self; studio/admin must pass `customer_id`. Assigns `caseId` (#XXX-001) automatically.
 *
 *       Accepts full prototype intake **TC_01–TC_06** (and optional TC_08–09 signature fields). Studio dashboard uses an
 *       **8-step wizard** (TC_01–TC_06 → KI pricing preview → review) before calling this endpoint.
 *
 *       **Photo fields** (`photo_intake_*`, zone `foto_url`) accept URL strings — upload service not built yet.
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CaseCreateBody'
 *           example:
 *             customer_id: "507f1f77bcf86cd799439011"
 *             type: tattoo
 *             tc_title: Unterarm links Schriftzug
 *             tc_body_location_main: arm
 *             tc_age_bucket: age_4_7
 *             tc_type: professional
 *             tc_coverup: none
 *             tc_prior_treatment: false
 *             tc_colors_present: [black]
 *             tc_density: medium
 *             tc_saturation: medium
 *             tc_shading: low
 *             tc_linework: medium
 *             tc_size_length: 8
 *             tc_size_width: 5
 *             skin_fitzpatrick_type: III
 *             skin_sun_zone: medium
 *             life_smoker: never
 *             life_alcohol: occasional
 *             life_activity: moderate
 *             life_sleep_hours: "7_8"
 *             life_sleep_quality: good
 *             life_stress: moderate
 *             life_height_cm: 172
 *             life_weight_kg: 70
 *             life_hydration: good
 *             life_nutrition: good
 *             goal_target: full_removal
 *             zonen_aktiv: false
 *             status: pending
 *     responses:
 *       201:
 *         description: Case created
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 */
router.post(
    '/',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(createCaseSchema),
    caseController.createCase
);

/**
 * @swagger
 * /cases/pricing/preview:
 *   post:
 *     summary: Preview price + session estimate from intake payload (no saved case)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Rule-based **7-factor pricing** + session estimate (prototype `calculatePrice` / `calcSessions`).
 *       Does **not** use photo AI — confidence reflects missing intake fields, not image analysis.
 *
 *       Used by:
 *       - **Studio dashboard** — case wizard step 7 (KI · Analyse) before review/save
 *       - **Mobile app** — KI result screen after TC_06 (before anamnese)
 *
 *       Uses the caller's studio pricing overrides from `/config/studio` when available.
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CasePricingPreviewBody'
 *           example:
 *             type: tattoo
 *             tc_title: Unterarm links Schriftzug
 *             tc_body_location_main: arm
 *             tc_age_bucket: age_4_7
 *             tc_type: professional
 *             tc_coverup: none
 *             tc_prior_treatment: false
 *             tc_colors_present: [black]
 *             tc_density: medium
 *             tc_saturation: medium
 *             tc_shading: low
 *             tc_linework: medium
 *             tc_size_length: 8
 *             tc_size_width: 5
 *             skin_fitzpatrick_type: III
 *             skin_sun_zone: medium
 *             life_smoker: never
 *             life_activity: moderate
 *             goal_target: full_removal
 *             zonen_aktiv: false
 *     responses:
 *       200:
 *         description: Pricing + session preview (studio sees full breakdown)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CasePricingPreviewResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post(
    '/pricing/preview',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(previewCasePricingSchema),
    caseController.previewCasePricing
);

/**
 * @swagger
 * /cases:
 *   get:
 *     summary: List cases
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Customer sees own cases; studio sees studio cases; admin can filter by customer_id or studio_id.
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: customer_id
 *         schema: { type: string }
 *       - in: query
 *         name: studio_id
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, active, completed, loeschantrag_ausstehend] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated case list
 */
router.get(
    '/',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(listCasesQuerySchema, 'query'),
    caseController.listCases
);

/**
 * @swagger
 * /cases/{id}/availability:
 *   get:
 *     summary: Get booking availability for a case
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Returns earliest bookable date and blocked days for the calendar UI.
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: consultationOnly
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: uv_level
 *         schema: { type: string, enum: [none, moderate, intense] }
 *     responses:
 *       200:
 *         description: Availability window for booking calendar
 */
router.get(
    '/:id/availability',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(availabilityQuerySchema, 'query'),
    caseController.getCaseAvailability
);

/**
 * @swagger
 * /cases/{id}/pricing:
 *   get:
 *     summary: Get session price estimate for a saved case
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Same **7-factor formula** as `POST /cases/pricing/preview`. For zone cases (`zonen_aktiv: true`),
 *       loads zones from DB and returns per-zone rows + aggregated price/session range.
 *
 *       - **Customer:** AB estimate only (`priceFrom`, `totalMin`/`totalMax`, no multiplier breakdown)
 *       - **Studio/admin:** full breakdown including `multipliers` when applicable
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Price estimate (role-scoped)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CasePricingResponse'
 *       404:
 *         description: Case not found
 */
router.get(
    '/:id/pricing',
    protect,
    authorize(...caseAccessRoles),
    caseController.getCasePricing
);

/**
 * @swagger
 * /cases/{id}/anamnesis:
 *   get:
 *     summary: Get medical anamnesis for a case
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Anamnesis record or null if not filled
 */
router.get(
    '/:id/anamnesis',
    protect,
    authorize(...caseAccessRoles),
    anamnesisController.getCaseAnamnesis
);

/**
 * @swagger
 * /cases/{id}/anamnesis:
 *   put:
 *     summary: Create or update medical anamnesis
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [antworten]
 *             properties:
 *               antworten: { type: object }
 *     responses:
 *       200:
 *         description: Anamnesis updated
 *       201:
 *         description: Anamnesis created
 */
router.put(
    '/:id/anamnesis',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(upsertAnamnesisSchema),
    anamnesisController.upsertCaseAnamnesis
);

/**
 * @swagger
 * /cases/{id}:
 *   get:
 *     summary: Get case by ID
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Scoped to own case / studio / admin access.
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Case details (includes zones when zonen_aktiv)
 *       404:
 *         description: Case not found
 */
router.get(
    '/:id',
    protect,
    authorize(...caseAccessRoles),
    caseController.getCase
);

/**
 * @swagger
 * /cases/{id}:
 *   patch:
 *     summary: Update case
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       **Customers** may PATCH intake fields only (TC_01–TC_06, photos, goal, lifestyle — see `CaseIntakeFields`).
 *       **Studio/admin** may additionally update `status`, `pricePerSession`, `sessionsDone`, `removal`, `healing`, etc.
 *
 *       Passing `zonen` replaces zone rows when `zonen_aktiv` is true (2–8 zones).
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             allOf:
 *               - $ref: '#/components/schemas/CaseIntakeFields'
 *               - type: object
 *                 properties:
 *                   status: { type: string, enum: [pending, active, completed, loeschantrag_ausstehend] }
 *                   pricePerSession: { type: number, description: Studio/admin only — hidden from customer responses }
 *                   sessionsDone: { type: number }
 *                   removal: { type: number }
 *                   healing: { type: number }
 *     responses:
 *       200:
 *         description: Case updated
 */
router.patch(
    '/:id',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(updateCaseSchema),
    caseController.updateCase
);

module.exports = router;

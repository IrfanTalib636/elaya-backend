const express = require('express');
const caseController = require('../controllers/caseController');
const anamnesisController = require('../controllers/anamnesisController');
const bookingPrecheckController = require('../controllers/bookingPrecheckController');
const signatureController = require('../controllers/signatureController');
const validateMiddleware = require('../middleware/validateMiddleware');
const { protect, authorize } = require('../middleware/authMiddleware');
const { createCaseSchema, updateCaseSchema, previewCasePricingSchema, availabilityQuerySchema, listCasesQuerySchema } = require('../validators/caseValidator');
const { upsertAnamnesisSchema, previewAnamnesisSchema } = require('../validators/anamnesisValidator');
const { bookingPrecheckBodySchema } = require('../validators/bookingPrecheckValidator');
const { updateKlaerungSchema, updateStudioFreigabeSchema } = require('../validators/klaerungValidator');
const { submitSignatureSchema, merkblattQuerySchema } = require('../validators/signatureValidator');
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
 *       Photo fields (photo_intake_*, zone foto_url) store private file asset IDs from POST /files/staging.
 *       Images are served only via authenticated GET /files/{id}/content — no public URLs.
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
 * /cases/{id}/anamnesis/preview:
 *   post:
 *     summary: Preview ampel + inline hints for partial anamnesis answers (no save)
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               antworten: { type: object }
 *     responses:
 *       200:
 *         description: Live ampel evaluation with inline_hints and summary blocks
 */
router.post(
    '/:id/anamnesis/preview',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(previewAnamnesisSchema),
    anamnesisController.previewCaseAnamnesis
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
 * /cases/{id}/anamnesis/klaerung:
 *   patch:
 *     summary: Studio review of a medical flag (klaerung)
 *     description: |
 *       Updates klaerung status for one flagged question (F{nr}).
 *       Does **not** alter original anamnesis antworten — review is stored separately with timestamp and staff name.
 *       Recalculates effective ampel (offen→rot, in_klaerung→orange, all geklaert→gruen).
 *       Studio/admin only.
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
 *             required: [frage_key, status]
 *             properties:
 *               frage_key:
 *                 type: string
 *                 example: F5
 *                 description: Flag key F{frage_nr}
 *               status:
 *                 type: string
 *                 enum: [offen, in_klaerung, geklaert]
 *               notiz:
 *                 type: string
 *                 description: Optional studio note
 *     responses:
 *       200:
 *         description: Klaerung updated; returns anamnesis + case_flags (ampel)
 *       400:
 *         description: Unknown frage_key or validation error
 *       403:
 *         description: Customer cannot update klaerung
 */
router.patch(
    '/:id/anamnesis/klaerung',
    protect,
    authorize(USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    validateMiddleware(updateKlaerungSchema),
    anamnesisController.updateKlaerung
);

/**
 * @swagger
 * /cases/{id}/studio-freigabe:
 *   patch:
 *     summary: Approve or reject Stufe-2 studio freigabe
 *     description: |
 *       For cases where anamnesis triggered studio_freigabe.erforderlich (e.g. diabetes).
 *       Sets status freigegeben | abgelehnt | ausstehend with staff + timestamp.
 *       Appends system chat stub and immutable audit entry. Studio/admin only.
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [freigegeben, abgelehnt, ausstehend]
 *               notiz: { type: string }
 *               grund: { type: string, description: Used when abgelehnt }
 *     responses:
 *       200:
 *         description: Freigabe updated
 *       400:
 *         description: Freigabe not required for this case
 *       403:
 *         description: Customer cannot update freigabe
 */
router.patch(
    '/:id/studio-freigabe',
    protect,
    authorize(USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    validateMiddleware(updateStudioFreigabeSchema),
    anamnesisController.updateStudioFreigabe
);

/**
 * @swagger
 * /cases/{id}/booking-precheck:
 *   get:
 *     summary: PS_01 booking pre-check form (customer treatment booking)
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
 *         description: |
 *           PS_01 form schema — uv_options, medication_groups, ko_rechecks,
 *           rote_fragen_rechecks, prerequisites (anamnesis_complete, can_book_treatment)
 */
router.get(
    '/:id/booking-precheck',
    protect,
    authorize(...caseAccessRoles),
    bookingPrecheckController.getBookingPrecheck
);

/**
 * @swagger
 * /cases/{id}/booking-precheck/preview:
 *   post:
 *     summary: Validate PS_01 answers before opening booking calendar
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
 *             properties:
 *               consultation_only: { type: boolean }
 *               pre_session:
 *                 type: object
 *                 properties:
 *                   uv_exposition: { type: string }
 *                   medikamente: { type: array, items: { type: string } }
 *                   medikament_datum: { type: string, format: date-time }
 *               ko_answers: { type: object }
 *               wiederholungen: { type: object }
 *               wiederholungen_confirmed: { type: boolean }
 *               ko_signature: { type: object }
 *     responses:
 *       200:
 *         description: Validation result with can_proceed, blocks, and availability hint
 */
router.post(
    '/:id/booking-precheck/preview',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(bookingPrecheckBodySchema),
    bookingPrecheckController.previewBookingPrecheck
);

/**
 * @swagger
 * /cases/{id}/merkblatt:
 *   get:
 *     summary: Get TC_08 aftercare merkblatt content for a case
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: locale
 *         schema: { type: string, enum: [de, en], default: de }
 *     responses:
 *       200:
 *         description: Merkblatt sections, labels, and case summary for signature flow
 */
router.get(
    '/:id/merkblatt',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(merkblattQuerySchema, 'query'),
    signatureController.getCaseMerkblatt
);

/**
 * @swagger
 * /cases/{id}/signature:
 *   post:
 *     summary: Submit TC_09 digital signature and finalize draft case
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
 *             required: [merkblatt_gelesen, bestaetigung_text, unterschrift_data]
 *     responses:
 *       200:
 *         description: Signature saved; draft cases move to pending
 *       400:
 *         description: Anamnesis not complete
 *       409:
 *         description: Already signed (customer)
 */
router.get(
    '/:id/signature/image',
    protect,
    authorize(...caseAccessRoles),
    signatureController.getCaseSignatureImage
);

router.post(
    '/:id/signature',
    protect,
    authorize(...caseAccessRoles),
    validateMiddleware(submitSignatureSchema),
    signatureController.submitCaseSignature
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

/**
 * @swagger
 * /cases/{id}:
 *   delete:
 *     summary: Delete an incomplete (unsigned) draft/pending case
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
 *         description: Case deleted
 *       400:
 *         description: Case is signed or not deletable
 */
router.delete(
    '/:id',
    protect,
    authorize(...caseAccessRoles),
    caseController.deleteIncompleteCase
);

module.exports = router;

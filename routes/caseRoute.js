const express = require('express');
const caseController = require('../controllers/caseController');
const validateMiddleware = require('../middleware/validateMiddleware');
const { protect, authorize } = require('../middleware/authMiddleware');
const { createCaseSchema, updateCaseSchema, availabilityQuerySchema, listCasesQuerySchema } = require('../validators/caseValidator');
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
 *       Customer creates for self; studio/admin must pass customer_id. Assigns caseId (#XXX-001) automatically.
 *     tags: [Cases]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customer_id: { type: string, description: Required for studio/admin roles }
 *               type: { type: string, enum: [tattoo, pmu] }
 *               tc_title: { type: string }
 *               bodyLabel: { type: string }
 *               tc_colors_present: { type: array, items: { type: string } }
 *               tc_size_length: { type: number }
 *               tc_size_width: { type: number }
 *               tc_type: { type: string, enum: [amateur, cosmetic, professional, coverup] }
 *               tc_age_years: { type: number }
 *               skin_fitzpatrick: { type: integer, minimum: 1, maximum: 6 }
 *               tc_coverup: { type: string, enum: [none, once, multiple] }
 *               goal_target: { type: string, enum: [full, partial_fade, lightening_for_coverup] }
 *               zonen_aktiv: { type: boolean }
 *               zonen: { type: array, items: { type: object } }
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
 *     summary: Get session price estimate for a case
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       7-factor formula (client §5d). Customer sees AB estimate only; studio/admin see full breakdown.
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
 */
router.get(
    '/:id/pricing',
    protect,
    authorize(...caseAccessRoles),
    caseController.getCasePricing
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
 *       Customers can update intake fields only; studio/admin can update status, pricing, and clinical fields.
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
 *               tc_title: { type: string }
 *               bodyLabel: { type: string }
 *               status: { type: string }
 *               pricePerSession: { type: number, description: Studio/admin only — hidden from customer responses }
 *               sessionsDone: { type: number }
 *               removal: { type: number }
 *               healing: { type: number }
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

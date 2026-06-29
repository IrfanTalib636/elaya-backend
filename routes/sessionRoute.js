const express = require('express');
const sessionController = require('../controllers/sessionController');
const validateMiddleware = require('../middleware/validateMiddleware');
const { protect, authorize } = require('../middleware/authMiddleware');
const { createSessionSchema, updateSessionSchema, listSessionsQuerySchema } = require('../validators/sessionValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const readRoles = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

const manageRoles = [
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * /sessions:
 *   post:
 *     summary: Record a treatment session
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Auto-assigns session_number and syncs case sessionsDone / lastSessionDate. Customers cannot POST.
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [case_id, treatment_date]
 *             properties:
 *               case_id: { type: string }
 *               treatment_date: { type: string, format: date-time }
 *               treatment_time: { type: string, example: "10:00" }
 *               wavelength_nm: { type: array, items: { type: number }, example: [1064] }
 *               removal_pct: { type: number }
 *               is_draft: { type: boolean }
 *               is_no_show: { type: boolean }
 *               zahlung: { type: object }
 *     responses:
 *       201:
 *         description: Session recorded
 */
router.post(
    '/',
    protect,
    authorize(...manageRoles),
    validateMiddleware(createSessionSchema),
    sessionController.createSession
);

/**
 * @swagger
 * /sessions:
 *   get:
 *     summary: List treatment sessions
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer (read-only), studio_admin, studio_staff, admin, super_admin
 *
 *       Customer sees progress fields only — no laser/payment details.
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: case_id
 *         schema: { type: string }
 *       - in: query
 *         name: customer_id
 *         schema: { type: string }
 *       - in: query
 *         name: is_draft
 *         schema: { type: string, enum: [true, false] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated session list
 */
router.get('/', protect, authorize(...readRoles), validateMiddleware(listSessionsQuerySchema, 'query'), sessionController.listSessions);

/**
 * @swagger
 * /sessions/{id}:
 *   get:
 *     summary: Get session by ID
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer (read-only), studio_admin, studio_staff, admin, super_admin
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Session details
 */
router.get('/:id', protect, authorize(...readRoles), sessionController.getSession);

/**
 * @swagger
 * /sessions/{id}:
 *   patch:
 *     summary: Update session protocol
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Re-syncs case session stats after update. Customers cannot PATCH.
 *     tags: [Sessions]
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
 *     responses:
 *       200:
 *         description: Session updated
 */
router.patch(
    '/:id',
    protect,
    authorize(...manageRoles),
    validateMiddleware(updateSessionSchema),
    sessionController.updateSession
);

module.exports = router;

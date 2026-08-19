const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const aiRateLimiter = require('../middleware/aiRateLimiter');
const {
    photoCheck,
    createCheck,
    listChecks,
    getCheck,
    reviewCheck,
} = require('../controllers/nachsorgeController');
const {
    nachsorgePhotoCheckSchema,
    nachsorgeCheckSchema,
    listNachsorgeQuerySchema,
    nachsorgeReviewSchema,
} = require('../validators/nachsorgeValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const CUSTOMER_AND_STUDIO = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

const STUDIO_AND_ADMIN = [
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.DEVELOPER,
];

/**
 * @swagger
 * tags:
 *   name: Nachsorge
 *   description: AI aftercare check (photo + symptoms). Anthropic key is server-side only.
 */

/**
 * @swagger
 * /nachsorge/photo-check:
 *   post:
 *     summary: Stage 1 — photo-only AI aftercare analysis
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio, admin
 *
 *       Upload photo first via `POST /files/staging` with `slot=nachsorge`, then pass `foto_file_id`.
 *     tags: [Nachsorge]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [case_id, foto_file_id]
 *             properties:
 *               case_id: { type: string }
 *               foto_file_id: { type: string }
 *               sitzungs_datum: { type: string, format: date, nullable: true }
 *     responses:
 *       200:
 *         description: Photo analysis (ampel + befund)
 *       503:
 *         description: AI not configured (fallback orange still returned for photo-check when key missing — see body.ai_available)
 */
router.post(
    '/photo-check',
    protect,
    authorize(...CUSTOMER_AND_STUDIO),
    aiRateLimiter,
    validateMiddleware(nachsorgePhotoCheckSchema),
    photoCheck
);

/**
 * @swagger
 * /nachsorge/check:
 *   post:
 *     summary: Stage 2 — combined photo + symptoms, persist check, award coins
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio, admin
 *
 *       Photo overrides symptoms. Awards `nachsorge_check` Elaycoins when applicable.
 *     tags: [Nachsorge]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [case_id, foto_file_id]
 *             properties:
 *               case_id: { type: string }
 *               foto_file_id: { type: string }
 *               symptome:
 *                 type: array
 *                 items: { type: string }
 *                 example: [schmerzen, roetung]
 *               sitzungs_datum: { type: string, format: date, nullable: true }
 *     responses:
 *       201:
 *         description: Check saved
 */
router.post(
    '/check',
    protect,
    authorize(...CUSTOMER_AND_STUDIO),
    aiRateLimiter,
    validateMiddleware(nachsorgeCheckSchema),
    createCheck
);

/**
 * @swagger
 * /nachsorge:
 *   get:
 *     summary: List aftercare checks
 *     description: |
 *       **Auth:** Bearer · Customer sees own checks; studio sees studio-scoped checks.
 *     tags: [Nachsorge]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: case_id
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated checks
 */
router.get(
    '/',
    protect,
    authorize(...CUSTOMER_AND_STUDIO),
    validateMiddleware(listNachsorgeQuerySchema, 'query'),
    listChecks
);

/**
 * @swagger
 * /nachsorge/{id}/review:
 *   patch:
 *     summary: Studio confirms or corrects a healing assessment
 *     tags: [Nachsorge]
 *     security:
 *       - bearerAuth: []
 */
router.patch(
    '/:id/review',
    protect,
    authorize(...STUDIO_AND_ADMIN),
    validateMiddleware(nachsorgeReviewSchema),
    reviewCheck
);

/**
 * @swagger
 * /nachsorge/{id}:
 *   get:
 *     summary: Get one aftercare check
 *     tags: [Nachsorge]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Check detail
 *       404:
 *         description: Not found
 */
router.get('/:id', protect, authorize(...CUSTOMER_AND_STUDIO), getCheck);

module.exports = router;

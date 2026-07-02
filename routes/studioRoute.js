const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const {
    getStudioSettings,
    patchStudioSettings,
} = require('../controllers/studioController');
const { patchStudioSettingsSchema } = require('../validators/studioValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const studioRoles = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

/**
 * @swagger
 * /studio/settings:
 *   get:
 *     summary: Get own studio settings (profile, hours, rooms, staff)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff
 *
 *       Returns profile, opening hours, treatment rooms, staff roster, and buffer time.
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Studio settings
 *       403:
 *         description: Studio account required
 */
router.get(
    '/settings',
    protect,
    authorize(...studioRoles),
    getStudioSettings
);

/**
 * @swagger
 * /studio/settings:
 *   patch:
 *     summary: Update own studio settings
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin only
 *
 *       Partial update — send only the sections you want to change.
 *       `behandlungsraeume` and `mitarbeiter` replace the full arrays when provided.
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profile:
 *                 type: object
 *                 properties:
 *                   firma: { type: string }
 *                   telefon: { type: string }
 *                   strasse: { type: string }
 *                   plz: { type: string }
 *                   ort: { type: string }
 *                   land: { type: string }
 *                   notizen: { type: string }
 *               oeffnungszeiten:
 *                 type: object
 *               behandlungsraeume:
 *                 type: array
 *               mitarbeiter:
 *                 type: array
 *               pufferzeit_minuten:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Updated studio settings
 *       403:
 *         description: Studio admin required
 */
router.patch(
    '/settings',
    protect,
    authorize(USER_ROLES.STUDIO_ADMIN),
    validateMiddleware(patchStudioSettingsSchema),
    patchStudioSettings
);

/**
 * @swagger
 * /studio/studios/{studioId}/settings:
 *   get:
 *     summary: Get studio settings by ID (admin)
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studioId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Studio settings
 */
router.get(
    '/studios/:studioId/settings',
    protect,
    authorize(...adminRoles),
    getStudioSettings
);

/**
 * @swagger
 * /studio/studios/{studioId}/settings:
 *   patch:
 *     summary: Update studio settings by ID (admin)
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studioId
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
 *         description: Updated studio settings
 */
router.patch(
    '/studios/:studioId/settings',
    protect,
    authorize(...adminRoles),
    validateMiddleware(patchStudioSettingsSchema),
    patchStudioSettings
);

module.exports = router;

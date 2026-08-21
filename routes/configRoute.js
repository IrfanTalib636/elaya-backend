const express = require('express');
const configController = require('../controllers/configController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const {
    patchPlatformConfigSchema,
    patchStudioConfigSchema,
    sessionPredictionPreviewSchema,
} = require('../validators/configValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];
const studioRoles = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const allAuthenticatedRoles = [
    USER_ROLES.CUSTOMER,
    ...studioRoles,
    ...adminRoles,
];
const studioAndAdminRoles = [...studioRoles, ...adminRoles];

/**
 * @swagger
 * /config/public:
 *   get:
 *     summary: Public platform config (group booking + Elaycoin display limits)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Safe subset for customer/studio apps — no finance admin fields.
 *     tags: [Config]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Public config subset for customer/studio apps
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data: { type: object }
 *       401:
 *         description: Not authorized
 */
router.get('/public', protect, authorize(...allAuthenticatedRoles), configController.getPublic);

/**
 * @swagger
 * /config/session-prediction/preview:
 *   post:
 *     summary: Live Sitzungsprognose calculator (no persist)
 *     description: |
 *       **Auth:** Bearer · studio + admin.
 *       Runs the real sessionPredictionEngine against draft parameters and a sample case.
 *     tags: [Config]
 *     security:
 *       - bearerAuth: []
 */
router.post(
    '/session-prediction/preview',
    protect,
    authorize(...studioAndAdminRoles),
    validate(sessionPredictionPreviewSchema),
    configController.previewSessionPredictionHandler
);

/**
 * @swagger
 * /config/platform:
 *   get:
 *     summary: Full platform config (admin)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** admin, super_admin
 *
 *       Maps prototype elaya_admin_config — Elaycoin, finance, and group booking settings.
 *     tags: [Config]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Platform config
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PlatformConfigResponse'
 *       401:
 *         description: Not authorized
 *       403:
 *         description: Admin role required
 */
router.get('/platform', protect, authorize(...adminRoles), configController.getPlatform);

/**
 * @swagger
 * /config/platform:
 *   patch:
 *     summary: Update platform config (admin)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** admin, super_admin
 *     tags: [Config]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PlatformConfig'
 *     responses:
 *       200:
 *         description: Updated platform config
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PlatformConfigResponse'
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Admin role required
 */
router.patch(
    '/platform',
    protect,
    authorize(...adminRoles),
    validate(patchPlatformConfigSchema),
    configController.patchPlatform
);

/**
 * @swagger
 * /config/studio:
 *   get:
 *     summary: Own studio config (pricing + Elaycoin overrides)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff
 *
 *       Uses the logged-in user's studio_id — no path param needed.
 *     tags: [Config]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Studio config for current user's studio
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StudioConfigResponse'
 *       403:
 *         description: Studio account required
 */
router.get('/studio', protect, authorize(...studioRoles), configController.getStudioConfig);

/**
 * @swagger
 * /config/studio:
 *   patch:
 *     summary: Update own studio config (studio admin)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin only
 *
 *       Adjust pricing multipliers and Elaycoin situation overrides.
 *     tags: [Config]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PatchStudioConfigBody'
 *     responses:
 *       200:
 *         description: Updated studio config
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StudioConfigResponse'
 *       403:
 *         description: Studio admin required
 */
router.patch(
    '/studio',
    protect,
    authorize(USER_ROLES.STUDIO_ADMIN),
    validate(patchStudioConfigSchema),
    configController.patchStudioConfigHandler
);

/**
 * @swagger
 * /config/studios/{studioId}:
 *   get:
 *     summary: Studio config by ID (admin)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** admin, super_admin
 *
 *       Copy studioId from GET /cases → studio field, or from npm run seed:dev output.
 *     tags: [Config]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studioId
 *         required: true
 *         description: Studio MongoDB ObjectId (24-char hex)
 *         schema:
 *           type: string
 *           example: 507f1f77bcf86cd799439011
 *     responses:
 *       200:
 *         description: Studio config
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StudioConfigResponse'
 *       400:
 *         description: Invalid studioId format
 *       404:
 *         description: Studio not found
 */
router.get(
    '/studios/:studioId',
    protect,
    authorize(...adminRoles),
    configController.getStudioConfig
);

/**
 * @swagger
 * /config/studios/{studioId}:
 *   patch:
 *     summary: Update studio config by ID (admin)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** admin, super_admin
 *     tags: [Config]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studioId
 *         required: true
 *         description: Studio MongoDB ObjectId (24-char hex)
 *         schema:
 *           type: string
 *           example: 507f1f77bcf86cd799439011
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PatchStudioConfigBody'
 *     responses:
 *       200:
 *         description: Updated studio config
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/StudioConfigResponse'
 *       400:
 *         description: Invalid studioId or validation failed
 *       404:
 *         description: Studio not found
 */
router.patch(
    '/studios/:studioId',
    protect,
    authorize(...adminRoles),
    validate(patchStudioConfigSchema),
    configController.patchStudioConfigHandler
);

router.get(
    '/features/catalog',
    protect,
    authorize(...adminRoles),
    configController.getFeatureCatalog
);

router.get(
    '/features/effective',
    protect,
    authorize(...allAuthenticatedRoles),
    configController.getEffectiveFeatures
);

router.get(
    '/features/studios',
    protect,
    authorize(...adminRoles),
    configController.listStudioFeaturesAdmin
);

module.exports = router;

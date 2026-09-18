const express = require('express');
const laserController = require('../controllers/laserController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const { z } = require('zod');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];
const studioRoles = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const studioAndAdmin = [...studioRoles, ...adminRoles];

const laserBodySchema = z
    .object({
        manufacturer: z.string().trim().min(1).max(120),
        model: z.string().trim().min(1).max(120),
        wavelengths_nm: z.array(z.number().positive().max(20000)).max(20).optional(),
        notes: z.string().max(2000).optional(),
        active: z.boolean().optional(),
    })
    .strict();

const laserPatchSchema = laserBodySchema.partial().strict();

const laserRequestSchema = z
    .object({
        manufacturer: z.string().trim().min(1).max(120),
        model: z.string().trim().min(1).max(120),
        wavelengths_nm: z.array(z.number().positive().max(20000)).max(20).optional(),
        notes: z.string().max(2000).optional(),
    })
    .strict();

const resolveSchema = z
    .object({
        decision: z.enum(['approved', 'rejected']),
        admin_note: z.string().max(2000).optional(),
    })
    .strict();

router.get('/', protect, authorize(...studioAndAdmin), laserController.listLasers);
router.get('/requests', protect, authorize(...adminRoles), laserController.listLaserRequests);
router.post(
    '/requests',
    protect,
    authorize(...studioRoles),
    validate(laserRequestSchema),
    laserController.requestLaser
);
router.post(
    '/requests/:id/resolve',
    protect,
    authorize(...adminRoles),
    validate(resolveSchema),
    laserController.resolveLaserRequest
);
router.get('/:id', protect, authorize(...studioAndAdmin), laserController.getLaser);
router.post(
    '/',
    protect,
    authorize(...adminRoles),
    validate(laserBodySchema),
    laserController.createLaser
);
router.patch(
    '/:id',
    protect,
    authorize(...adminRoles),
    validate(laserPatchSchema),
    laserController.patchLaser
);

module.exports = router;

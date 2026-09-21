const express = require('express');
const adminUserController = require('../controllers/adminUserController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const { z } = require('zod');
const { USER_ROLES, USER_STATUS } = require('../config/constants');
const { ADMIN_PERMISSION_LIST } = require('../config/adminPermissions');

const router = express.Router();
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

const permissionEnum =
    ADMIN_PERMISSION_LIST.length > 0
        ? z.enum(/** @type {[string, ...string[]]} */ (ADMIN_PERMISSION_LIST))
        : z.string();

const inviteSchema = z
    .object({
        email: z.string().email(),
        name: z.string().trim().max(120).optional(),
        role: z.enum([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN]).optional(),
        permissions: z.array(permissionEnum).optional(),
    })
    .strict();

const patchSchema = z
    .object({
        name: z.string().trim().max(120).optional(),
        role: z.enum([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN]).optional(),
        status: z
            .enum([USER_STATUS.AKTIV, USER_STATUS.GESPERRT, USER_STATUS.AUSSTEHEND])
            .optional(),
        permissions: z.array(permissionEnum).optional(),
    })
    .strict();

router.get(
    '/permissions',
    protect,
    authorize(...adminRoles),
    adminUserController.getPermissionCatalog
);
router.get('/', protect, authorize(...adminRoles), adminUserController.listAdminUsers);
router.post(
    '/invite',
    protect,
    authorize(...adminRoles),
    validate(inviteSchema),
    adminUserController.inviteAdminUser
);
router.post(
    '/:id/resend-invite',
    protect,
    authorize(...adminRoles),
    adminUserController.resendAdminInvite
);
router.patch(
    '/:id',
    protect,
    authorize(...adminRoles),
    validate(patchSchema),
    adminUserController.patchAdminUser
);

module.exports = router;

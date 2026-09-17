const express = require('express');
const studioTeamController = require('../controllers/studioTeamController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const { z } = require('zod');
const { USER_ROLES, USER_STATUS } = require('../config/constants');
const { STUDIO_ACCOUNT_ROLE_LIST } = require('../config/studioAccountRoles');

const router = express.Router();

const studioRoles = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];
const studioAndAdmin = [...studioRoles, ...adminRoles];

const roleEnum = z.enum(/** @type {[string, ...string[]]} */ (STUDIO_ACCOUNT_ROLE_LIST));

const inviteSchema = z
    .object({
        email: z.string().email(),
        name: z.string().trim().max(120).optional(),
        studio_account_role: roleEnum.optional(),
        staff_profile_id: z.string().trim().nullable().optional(),
        studio_id: z.string().trim().optional(),
    })
    .strict();

const patchSchema = z
    .object({
        name: z.string().trim().max(120).optional(),
        status: z
            .enum([USER_STATUS.AKTIV, USER_STATUS.GESPERRT, USER_STATUS.AUSSTEHEND])
            .optional(),
        studio_account_role: roleEnum.optional(),
        staff_profile_id: z.string().trim().nullable().optional(),
        studio_id: z.string().trim().optional(),
    })
    .strict();

router.get(
    '/seats',
    protect,
    authorize(...studioAndAdmin),
    studioTeamController.getSeatStatusHandler
);
router.get(
    '/logins',
    protect,
    authorize(...studioAndAdmin),
    studioTeamController.listStudioLogins
);
router.post(
    '/logins/invite',
    protect,
    authorize(...studioAndAdmin),
    validate(inviteSchema),
    studioTeamController.inviteStudioLogin
);
router.patch(
    '/logins/:id',
    protect,
    authorize(...studioAndAdmin),
    validate(patchSchema),
    studioTeamController.patchStudioLogin
);

router.get(
    '/admin/logins',
    protect,
    authorize(...adminRoles),
    studioTeamController.listAllStudioLoginsAdmin
);
router.get(
    '/admin/staff-profiles',
    protect,
    authorize(...adminRoles),
    studioTeamController.listAllStaffProfilesAdmin
);

module.exports = router;

const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const { z } = require('zod');
const { USER_ROLES } = require('../config/constants');
const adminAuditController = require('../controllers/adminAuditController');

const router = express.Router();
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

const listQuerySchema = z
    .object({
        action: z.string().trim().max(120).optional(),
        date: z
            .string()
            .trim()
            .optional()
            .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), {
                message: 'date must be YYYY-MM-DD',
            }),
        page: z.coerce.number().int().min(1).max(10000).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
    })
    .strict();

router.use(protect, authorize(...adminRoles));

router.get('/', validate(listQuerySchema, 'query'), adminAuditController.listAuditLogs);

module.exports = router;

const express = require('express');
const { z } = require('zod');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');
const { STUDIO_LEAD_STATUS } = require('../models/studioLeadModel');
const {
    getCrmOverview,
    listStudioLeads,
    createStudioLead,
    updateStudioLead,
} = require('../controllers/adminCrmController');

const router = express.Router();

const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

const createLeadSchema = z.object({
    firma: z.string().trim().min(1).max(200),
    kontakt_name: z.string().trim().max(120).optional().default(''),
    email: z
        .string()
        .trim()
        .max(200)
        .optional()
        .default('')
        .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email'),
    telefon: z.string().trim().max(60).optional().default(''),
    ort: z.string().trim().max(120).optional().default(''),
    notiz: z.string().trim().max(2000).optional().default(''),
});

const updateLeadSchema = z.object({
    firma: z.string().trim().min(1).max(200).optional(),
    kontakt_name: z.string().trim().max(120).optional(),
    email: z
        .string()
        .trim()
        .max(200)
        .optional()
        .refine((v) => v === undefined || !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Invalid email'),
    telefon: z.string().trim().max(60).optional(),
    ort: z.string().trim().max(120).optional(),
    notiz: z.string().trim().max(2000).optional(),
    status: z.enum(Object.values(STUDIO_LEAD_STATUS)).optional(),
});

router.get('/overview', protect, authorize(...adminRoles), getCrmOverview);

router.get('/leads', protect, authorize(...adminRoles), listStudioLeads);

router.post(
    '/leads',
    protect,
    authorize(...adminRoles),
    validateMiddleware(createLeadSchema),
    createStudioLead
);

router.patch(
    '/leads/:id',
    protect,
    authorize(...adminRoles),
    validateMiddleware(updateLeadSchema),
    updateStudioLead
);

module.exports = router;

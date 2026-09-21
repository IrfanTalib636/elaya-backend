const express = require('express');
const { z } = require('zod');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');
const { LEAD_AKQUISE, LEAD_PAKETE } = require('../models/studioLeadModel');
const {
    getCrmOverview,
    listStudioLeads,
    createStudioLead,
    updateStudioLead,
    advanceStudioLead,
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
    adresse: z.string().trim().max(300).optional().default(''),
    notiz: z.string().trim().max(2000).optional().default(''),
    akquise_weg: z.enum(LEAD_AKQUISE).optional().default('other'),
    gewuenschtes_paket: z.enum(LEAD_PAKETE).optional().default('STARTER'),
    demo_termin_gebucht: z.boolean().optional().default(false),
    demo_termin_datum: z.union([z.string(), z.null()]).optional().nullable(),
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
    adresse: z.string().trim().max(300).optional(),
    notiz: z.string().trim().max(2000).optional(),
    akquise_weg: z.enum(LEAD_AKQUISE).optional(),
    gewuenschtes_paket: z.enum(LEAD_PAKETE).optional(),
    demo_termin_gebucht: z.boolean().optional(),
    demo_termin_datum: z.union([z.string(), z.null()]).optional().nullable(),
});

const advanceLeadSchema = z.object({
    action: z.enum([
        'send_contract',
        'sign_contract',
        'set_payment',
        'start_trial',
        'activate',
        'deactivate',
    ]),
    zahlungsweg: z.enum(['STRIPE_KARTE', 'RECHNUNG']).optional(),
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

router.post(
    '/leads/:id/advance',
    protect,
    authorize(...adminRoles),
    validateMiddleware(advanceLeadSchema),
    advanceStudioLead
);

module.exports = router;

const express = require('express');
const { z } = require('zod');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');
const { LEAD_AKQUISE, LEAD_PAKETE } = require('../models/studioLeadModel');
const {
    PLATFORM_CRM_SUBJECT_TYPES,
    PLATFORM_CRM_TASK_TYP,
    PLATFORM_CRM_TASK_PRIORITAET,
    PLATFORM_CRM_NOTE_TYP,
    CUSTOMER_FUNNEL_STAGE_ORDER,
    STUDIO_FUNNEL_STAGE_ORDER,
    CUSTOMER_DROPOFFS,
    STUDIO_DROPOFFS,
} = require('../config/platformCrmConfig');
const {
    getCrmOverview,
    listStudioLeads,
    createStudioLead,
    updateStudioLead,
    advanceStudioLead,
} = require('../controllers/adminCrmController');
const {
    getPlatformFunnel,
    listPlatformCustomers,
    getPlatformCustomerDetail,
    listPlatformStudioLeads,
    getPlatformStudioLeadDetail,
    listPlatformTasks,
    createPlatformTask,
    updatePlatformTask,
    listPlatformNotes,
    createPlatformNote,
} = require('../controllers/adminPlatformCrmController');

const router = express.Router();

const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

const taskTypValues = Object.values(PLATFORM_CRM_TASK_TYP);
const taskPrioValues = Object.values(PLATFORM_CRM_TASK_PRIORITAET);
const noteTypValues = Object.values(PLATFORM_CRM_NOTE_TYP);

const createPlatformTaskSchema = z.object({
    subject_type: z.enum(PLATFORM_CRM_SUBJECT_TYPES),
    subject_id: z.string().trim().min(1),
    titel: z.string().trim().min(1).max(300),
    typ: z.enum(taskTypValues).optional().default(PLATFORM_CRM_TASK_TYP.FOLLOWUP),
    prioritaet: z
        .enum(taskPrioValues)
        .optional()
        .default(PLATFORM_CRM_TASK_PRIORITAET.MITTEL),
    faellig_am: z.union([z.string(), z.date()]),
    zugewiesen_an: z.string().trim().max(120).optional().default(''),
});

const updatePlatformTaskSchema = z.object({
    titel: z.string().trim().min(1).max(300).optional(),
    typ: z.enum(taskTypValues).optional(),
    prioritaet: z.enum(taskPrioValues).optional(),
    faellig_am: z.union([z.string(), z.date()]).optional(),
    zugewiesen_an: z.string().trim().max(120).optional(),
    erledigt: z.boolean().optional(),
});

const createPlatformNoteSchema = z.object({
    subject_type: z.enum(PLATFORM_CRM_SUBJECT_TYPES),
    subject_id: z.string().trim().min(1),
    typ: z.enum(noteTypValues).optional().default(PLATFORM_CRM_NOTE_TYP.ANRUF),
    inhalt: z.string().trim().min(1).max(5000),
});

const listCustomersQuerySchema = z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    stage: z.enum(CUSTOMER_FUNNEL_STAGE_ORDER).optional(),
    dropoff: z.enum(CUSTOMER_DROPOFFS).optional(),
    q: z.string().optional(),
});

const listStudioLeadsQuerySchema = z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    stage: z.enum(STUDIO_FUNNEL_STAGE_ORDER).optional(),
    dropoff: z.enum(STUDIO_DROPOFFS).optional(),
    q: z.string().optional(),
});

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

router.get('/funnel', protect, authorize(...adminRoles), getPlatformFunnel);

router.get(
    '/customers',
    protect,
    authorize(...adminRoles),
    validateMiddleware(listCustomersQuerySchema, 'query'),
    listPlatformCustomers
);
router.get(
    '/customers/:id',
    protect,
    authorize(...adminRoles),
    getPlatformCustomerDetail
);

router.get(
    '/studio-leads',
    protect,
    authorize(...adminRoles),
    validateMiddleware(listStudioLeadsQuerySchema, 'query'),
    listPlatformStudioLeads
);
router.get(
    '/studio-leads/:id',
    protect,
    authorize(...adminRoles),
    getPlatformStudioLeadDetail
);

router.get('/tasks', protect, authorize(...adminRoles), listPlatformTasks);
router.post(
    '/tasks',
    protect,
    authorize(...adminRoles),
    validateMiddleware(createPlatformTaskSchema),
    createPlatformTask
);
router.patch(
    '/tasks/:id',
    protect,
    authorize(...adminRoles),
    validateMiddleware(updatePlatformTaskSchema),
    updatePlatformTask
);

router.get('/notes', protect, authorize(...adminRoles), listPlatformNotes);
router.post(
    '/notes',
    protect,
    authorize(...adminRoles),
    validateMiddleware(createPlatformNoteSchema),
    createPlatformNote
);

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

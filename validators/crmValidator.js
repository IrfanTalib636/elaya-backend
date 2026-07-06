const { z } = require('zod');
const { CRM_TASK_TYP, CRM_TASK_PRIORITAET, CRM_NOTE_TYP } = require('../config/crmDefaults');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const createCrmTaskSchema = z.object({
    customer_id: objectId.optional().nullable(),
    titel: z.string().trim().min(1).max(200),
    typ: z.enum(Object.values(CRM_TASK_TYP)).optional(),
    prioritaet: z.enum(Object.values(CRM_TASK_PRIORITAET)).optional(),
    faellig_am: z.string().min(1),
    zugewiesen_an: z.string().trim().max(100).optional(),
});

const updateCrmTaskSchema = z.object({
    titel: z.string().trim().min(1).max(200).optional(),
    typ: z.enum(Object.values(CRM_TASK_TYP)).optional(),
    prioritaet: z.enum(Object.values(CRM_TASK_PRIORITAET)).optional(),
    faellig_am: z.string().min(1).optional(),
    zugewiesen_an: z.string().trim().max(100).optional(),
    erledigt: z.boolean().optional(),
});

const createCrmNoteSchema = z.object({
    customer_id: objectId,
    typ: z.enum(Object.values(CRM_NOTE_TYP)).optional(),
    inhalt: z.string().trim().min(1).max(5000),
    /** Optional task created together with the note */
    aufgabe: z.object({
        titel: z.string().trim().min(1).max(200),
        typ: z.enum(Object.values(CRM_TASK_TYP)).optional(),
        prioritaet: z.enum(Object.values(CRM_TASK_PRIORITAET)).optional(),
        faellig_am: z.string().min(1).optional(),
    }).optional(),
});

module.exports = {
    createCrmTaskSchema,
    updateCrmTaskSchema,
    createCrmNoteSchema,
};

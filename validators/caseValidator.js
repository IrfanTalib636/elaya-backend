const { z } = require('zod');
const {
    AKQUISE_QUELLE,
    CASE_TYPE,
    CASE_STATUS,
    TC_TYPE,
    TC_COVERUP,
    GOAL_TARGET,
} = require('../config/constants');
const { paginationQueryFields } = require('./paginationValidator');

const akquiseQuelleEnum = z.enum([
    AKQUISE_QUELLE.STUDIO_EIGEN,
    AKQUISE_QUELLE.PLATTFORM_VERMITTELT,
    AKQUISE_QUELLE.STUDIO_WECHSEL,
]);

const caseTypeEnum = z.enum([CASE_TYPE.TATTOO, CASE_TYPE.PMU]);
const caseStatusEnum = z.enum(Object.values(CASE_STATUS));
const tcTypeEnum = z.enum(Object.values(TC_TYPE));
const tcCoverupEnum = z.enum(Object.values(TC_COVERUP));
const goalTargetEnum = z.enum(Object.values(GOAL_TARGET));

const optionalTrimmedString = z.string().trim().optional();

const caseZoneInputSchema = z.object({
    zonen_id: optionalTrimmedString,
    bezeichnung: optionalTrimmedString.default(''),
    koerperstelle: optionalTrimmedString.default(''),
    farben: z.array(z.string().trim()).optional().default([]),
    dichte: optionalTrimmedString.nullable().optional(),
    flaeche_cm2: z.number().min(0).nullable().optional(),
    foto_url: optionalTrimmedString.default(''),
    preis: z.number().min(0).optional().default(0),
    sitzungen_geschaetzt_min: z.number().min(0).optional().default(0),
    sitzungen_geschaetzt_max: z.number().min(0).optional().default(0),
});

const createCaseSchema = z.object({
    customer_id: z.string().trim().optional(),
    type: caseTypeEnum.default(CASE_TYPE.TATTOO),
    tc_title: optionalTrimmedString.default(''),
    bodyLabel: optionalTrimmedString.default(''),
    tc_colors_present: z.array(z.string().trim()).optional().default([]),
    tc_size_length: z.number().min(0).nullable().optional(),
    tc_size_width: z.number().min(0).nullable().optional(),
    tc_type: tcTypeEnum.nullable().optional(),
    tc_age_years: z.number().min(0).nullable().optional(),
    skin_fitzpatrick: z.number().int().min(1).max(6).nullable().optional(),
    tc_coverup: tcCoverupEnum.optional().default(TC_COVERUP.NONE),
    goal_target: goalTargetEnum.nullable().optional(),
    sessions: z.number().min(0).optional().default(0),
    sessionsMin: z.number().min(0).optional().default(0),
    sessionsMax: z.number().min(0).optional().default(0),
    akquise_quelle: akquiseQuelleEnum.optional(),
    zonen_aktiv: z.boolean().optional().default(false),
    zonen: z.array(caseZoneInputSchema).max(8).optional().default([]),
});

const updateCaseSchema = z
    .object({
        tc_title: optionalTrimmedString,
        bodyLabel: optionalTrimmedString,
        tc_colors_present: z.array(z.string().trim()).optional(),
        tc_size_length: z.number().min(0).nullable().optional(),
        tc_size_width: z.number().min(0).nullable().optional(),
        tc_type: tcTypeEnum.nullable().optional(),
        tc_age_years: z.number().min(0).nullable().optional(),
        skin_fitzpatrick: z.number().int().min(1).max(6).nullable().optional(),
        tc_coverup: tcCoverupEnum.optional(),
        goal_target: goalTargetEnum.nullable().optional(),
        sessions: z.number().min(0).optional(),
        sessionsMin: z.number().min(0).optional(),
        sessionsMax: z.number().min(0).optional(),
        sessionsDone: z.number().min(0).optional(),
        removal: z.number().min(0).max(100).optional(),
        healing: z.number().min(0).max(100).optional(),
        status: caseStatusEnum.optional(),
        lastSessionDate: z.coerce.date().nullable().optional(),
        pricePerSession: z.number().min(0).optional(),
        akquise_quelle: akquiseQuelleEnum.optional(),
        uvBlockDate: z.coerce.date().nullable().optional(),
        medicationBlockDate: z.coerce.date().nullable().optional(),
        zonen_aktiv: z.boolean().optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required to update',
    });

const preSessionCheckSchema = z.object({
    uv_exposition: z.enum(['keine', 'leicht', 'mittel', 'intensiv']).optional(),
    medikamente: z
        .array(z.enum(['retinoide', 'antibiotika', 'antidepressiva']))
        .optional()
        .default([]),
    medikament_datum: z.coerce.date().optional(),
});

const availabilityQuerySchema = z.object({
    consultationOnly: z
        .union([z.enum(['true', 'false']), z.boolean()])
        .optional()
        .transform((value) => value === true || value === 'true'),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    uv_level: z.enum(['none', 'moderate', 'intense']).optional(),
    uv_exposition: z.enum(['keine', 'leicht', 'mittel', 'intensiv']).optional(),
    medikamente: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .transform((value) => {
            if (!value) return [];
            const list = Array.isArray(value) ? value : value.split(',');
            return list.map((item) => item.trim()).filter(Boolean);
        }),
    medikament_datum: z.coerce.date().optional(),
});

const listCasesQuerySchema = z.object({
    ...paginationQueryFields,
    customer_id: z.string().trim().optional(),
    studio_id: z.string().trim().optional(),
    status: caseStatusEnum.optional(),
});

module.exports = {
    createCaseSchema,
    updateCaseSchema,
    caseZoneInputSchema,
    preSessionCheckSchema,
    availabilityQuerySchema,
    listCasesQuerySchema,
};

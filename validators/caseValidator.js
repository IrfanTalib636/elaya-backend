const { z } = require('zod');
const {
    AKQUISE_QUELLE,
    CASE_TYPE,
    CASE_STATUS,
    TC_TYPE,
    TC_COVERUP,
    GOAL_TARGET,
} = require('../config/constants');
const {
    BODY_LOCATIONS,
    TC_SIDE,
    TC_AGE_BUCKET,
    QUALITY_LEVEL,
    SHADING_LEVEL,
    LINEWORK_LEVEL,
    RISK_LEVEL,
    SUN_EXPOSURE,
    SKIN_FITZPATRICK_TYPE,
    LIFE_SMOKER,
    LIFE_ALCOHOL,
    LIFE_ACTIVITY,
    LIFE_SLEEP_HOURS,
    LIFE_SLEEP_QUALITY,
    LIFE_STRESS,
    LIFE_HYDRATION,
    LIFE_NUTRITION,
    ZONE_FLAECHE_TEMPLATE,
} = require('../config/caseIntakeEnums');
const { paginationQueryFields } = require('./paginationValidator');
const { normalizeGoalTarget } = require('../utils/caseIntakeHelpers');

const akquiseQuelleEnum = z.enum([
    AKQUISE_QUELLE.STUDIO_EIGEN,
    AKQUISE_QUELLE.PLATTFORM_VERMITTELT,
    AKQUISE_QUELLE.STUDIO_WECHSEL,
]);

const caseTypeEnum = z.enum([CASE_TYPE.TATTOO, CASE_TYPE.PMU]);
const caseStatusEnum = z.enum(Object.values(CASE_STATUS));
const tcTypeEnum = z.enum(Object.values(TC_TYPE));
const tcCoverupEnum = z.enum(Object.values(TC_COVERUP));

const goalTargetInput = z
    .enum([
        GOAL_TARGET.FULL,
        GOAL_TARGET.FULL_REMOVAL,
        GOAL_TARGET.PARTIAL_FADE,
        GOAL_TARGET.LIGHTENING_FOR_COVERUP,
    ])
    .transform(normalizeGoalTarget);

const optionalTrimmedString = z.string().trim().optional();

const photoStdIntakeSchema = z
    .object({
        photo_full_visible: z.boolean().optional(),
        photo_good_light: z.boolean().optional(),
        photo_focus: z.boolean().optional(),
        photo_distance: z.boolean().optional(),
        photo_no_filter: z.boolean().optional(),
    })
    .optional();

const unterschriftSchema = z
    .object({
        zeitstempel: z.coerce.date().nullable().optional(),
        merkblatt_gelesen: z.boolean().optional(),
        bestaetigung_text: z.union([z.string(), z.boolean()]).optional(),
        unterschrift_data: z.string().optional(),
    })
    .optional();

const caseZoneInputSchema = z.object({
    zonen_id: optionalTrimmedString,
    bezeichnung: optionalTrimmedString.default(''),
    koerperstelle: optionalTrimmedString.default(''),
    farben: z.array(z.string().trim()).optional().default([]),
    dichte: optionalTrimmedString.nullable().optional(),
    flaeche_cm2: z.number().min(0).nullable().optional(),
    flaeche_template: z.enum(ZONE_FLAECHE_TEMPLATE).nullable().optional(),
    flaeche_modus: z.enum(['template', 'manuell']).nullable().optional(),
    flaeche_manuell: z.number().min(0).nullable().optional(),
    foto_url: optionalTrimmedString.default(''),
    preis: z.number().min(0).optional().default(0),
    sitzungen_geschaetzt_min: z.number().min(0).optional().default(0),
    sitzungen_geschaetzt_max: z.number().min(0).optional().default(0),
});

/** Shared intake fields — prototype steps TC_01–TC_06 + TC_08–09 (all optional on create). */
const caseIntakeFieldsSchema = {
    tc_title: optionalTrimmedString.default(''),
    bodyLabel: optionalTrimmedString.default(''),
    tc_body_location_main: z.enum(BODY_LOCATIONS).nullable().optional(),
    tc_body_location_detail: optionalTrimmedString.default(''),
    tc_side: z.enum(TC_SIDE).nullable().optional(),
    tc_age_bucket: z.enum(TC_AGE_BUCKET).nullable().optional(),
    tc_prior_treatment: z.boolean().nullable().optional(),
    tc_prior_treatment_count: z.number().min(0).max(99).nullable().optional(),
    tc_colors_present: z.array(z.string().trim()).optional().default([]),
    tc_density: z.enum(QUALITY_LEVEL).nullable().optional(),
    tc_saturation: z.enum(QUALITY_LEVEL).nullable().optional(),
    tc_shading: z.enum(SHADING_LEVEL).nullable().optional(),
    tc_linework: z.enum(LINEWORK_LEVEL).nullable().optional(),
    tc_size_length: z.number().min(0).nullable().optional(),
    tc_size_width: z.number().min(0).nullable().optional(),
    tc_type: tcTypeEnum.nullable().optional(),
    tc_age_years: z.number().min(0).nullable().optional(),
    skin_fitzpatrick_type: z.enum(SKIN_FITZPATRICK_TYPE).nullable().optional(),
    skin_fitzpatrick: z.number().int().min(1).max(6).nullable().optional(),
    skin_hyperpig_risk: z.enum(RISK_LEVEL).nullable().optional(),
    skin_keloid_risk: z.enum(RISK_LEVEL).nullable().optional(),
    skin_sun_zone: z.enum(SUN_EXPOSURE).nullable().optional(),
    life_smoker: z.enum(LIFE_SMOKER).nullable().optional(),
    life_cig_per_day: z.number().min(0).max(60).nullable().optional(),
    life_alcohol: z.enum(LIFE_ALCOHOL).nullable().optional(),
    life_activity: z.enum(LIFE_ACTIVITY).nullable().optional(),
    life_sleep_hours: z.enum(LIFE_SLEEP_HOURS).nullable().optional(),
    life_sleep_quality: z.enum(LIFE_SLEEP_QUALITY).nullable().optional(),
    life_stress: z.enum(LIFE_STRESS).nullable().optional(),
    life_height_cm: z.number().min(0).nullable().optional(),
    life_weight_kg: z.number().min(0).nullable().optional(),
    life_hydration: z.enum(LIFE_HYDRATION).nullable().optional(),
    life_nutrition: z.enum(LIFE_NUTRITION).nullable().optional(),
    tc_coverup: tcCoverupEnum.optional().default(TC_COVERUP.NONE),
    goal_target: goalTargetInput.nullable().optional(),
    goal_notes: optionalTrimmedString.default(''),
    photo_intake_main: optionalTrimmedString.default(''),
    photo_intake_detail: optionalTrimmedString.default(''),
    photo_marker: optionalTrimmedString.default(''),
    photo_std_intake: photoStdIntakeSchema,
    merkblatt_pdf: optionalTrimmedString.default(''),
    unterschrift: unterschriftSchema,
};

const createCaseSchema = z.object({
    customer_id: z.string().trim().optional(),
    type: caseTypeEnum.default(CASE_TYPE.TATTOO),
    status: caseStatusEnum.optional(),
    ...caseIntakeFieldsSchema,
    sessions: z.number().min(0).optional().default(0),
    sessionsMin: z.number().min(0).optional().default(0),
    sessionsMax: z.number().min(0).optional().default(0),
    akquise_quelle: akquiseQuelleEnum.optional(),
    zonen_aktiv: z.boolean().optional().default(false),
    zonen: z.array(caseZoneInputSchema).max(8).optional().default([]),
});

const updateCaseSchema = z
    .object({
        ...Object.fromEntries(
            Object.entries(caseIntakeFieldsSchema).map(([key, schema]) => {
                if (key === 'tc_coverup') {
                    return [key, tcCoverupEnum.optional()];
                }
                if (key === 'goal_target') {
                    return [key, goalTargetInput.nullable().optional()];
                }
                if (schema instanceof z.ZodDefault) {
                    return [key, schema.removeDefault().optional()];
                }
                return [key, schema.optional()];
            })
        ),
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
        zonen: z.array(caseZoneInputSchema).max(8).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required to update',
    });

/** null / '' must not become Date(0) via z.coerce.date() */
const optionalNullableDate = z.preprocess(
    (value) => (value === null || value === '' || value === undefined ? undefined : value),
    z.coerce.date().optional()
);

const preSessionCheckSchema = z.object({
    uv_exposition: z.enum(['keine', 'leicht', 'mittel', 'intensiv']).optional(),
    medikamente: z
        .array(z.enum(['retinoide', 'antibiotika', 'antidepressiva']))
        .optional()
        .default([]),
    medikament_datum: optionalNullableDate,
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
    medikament_datum: optionalNullableDate,
});

const listCasesQuerySchema = z.object({
    ...paginationQueryFields,
    customer_id: z.string().trim().optional(),
    studio_id: z.string().trim().optional(),
    status: caseStatusEnum.optional(),
    medical_flag: z.enum(['gruen', 'orange', 'rot']).optional(),
    include_draft: z
        .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
        .optional()
        .transform((v) => v === true || v === 'true' || v === '1'),
});

const previewCasePricingSchema = createCaseSchema.omit({ customer_id: true });

module.exports = {
    createCaseSchema,
    updateCaseSchema,
    previewCasePricingSchema,
    caseZoneInputSchema,
    caseIntakeFieldsSchema,
    preSessionCheckSchema,
    availabilityQuerySchema,
    listCasesQuerySchema,
};

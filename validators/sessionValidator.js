const { z } = require('zod');
const { PAYMENT_CURRENCY, PAYMENT_METHOD } = require('../config/constants');
const { paginationQueryFields } = require('./paginationValidator');

const optionalTrimmedString = z.string().trim().optional();

const zahlungSchema = z
    .object({
        betrag: z.number().min(0).optional(),
        betragCHF: z.number().min(0).optional(),
        waehrung: z.enum([PAYMENT_CURRENCY.CHF, PAYMENT_CURRENCY.EUR]).optional(),
        zahlungsart: z
            .enum([PAYMENT_METHOD.BAR, PAYMENT_METHOD.KARTE, PAYMENT_METHOD.TWINT])
            .nullable()
            .optional(),
        rabatt: z.number().min(0).optional(),
    })
    .optional();

const sessionFieldsSchema = {
    treatment_date: z.coerce.date({ required_error: 'treatment_date is required' }),
    treatment_time: optionalTrimmedString.default(''),
    appointment_id: optionalTrimmedString.nullable().optional(),
    standort_id: optionalTrimmedString.default(''),
    standort_name: optionalTrimmedString.default(''),
    mitarbeiter_id: optionalTrimmedString.default(''),
    mitarbeiter_name: optionalTrimmedString.default(''),
    raum_id: optionalTrimmedString.default(''),
    raum_name: optionalTrimmedString.default(''),
    dauer_minuten: z.number().min(0).nullable().optional(),
    laser_id: optionalTrimmedString.default(''),
    studio_laser_brand: optionalTrimmedString.default(''),
    studio_laser_model: optionalTrimmedString.default(''),
    laser_typ: optionalTrimmedString.default(''),
    wavelength_nm: z.array(z.number().min(0)).optional().default([]),
    fluence_j_cm2: z.number().min(0).nullable().optional(),
    spot_size_mm: z.number().min(0).nullable().optional(),
    frequency_hz: z.number().min(0).nullable().optional(),
    pass_count: z.number().min(0).nullable().optional(),
    cooling_used: z.boolean().optional().default(false),
    endpoint_reaction: optionalTrimmedString.default(''),
    pain_score_0_10: z.number().min(0).max(10).nullable().optional(),
    adverse_event_flag: z.boolean().optional().default(false),
    adverse_event_type: optionalTrimmedString.default(''),
    special_notes: optionalTrimmedString.default(''),
    removal_pct: z.number().min(0).max(100).nullable().optional(),
    verblassung_prozent: z.number().min(0).max(100).nullable().optional(),
    fortschritt_foto_data: optionalTrimmedString.default(''),
    image_quality_ok: z.boolean().nullable().optional(),
    photo_same_angle: z.boolean().nullable().optional(),
    photo_same_distance: z.boolean().nullable().optional(),
    photo_comparable_light: z.boolean().nullable().optional(),
    lightening_studio_pct: z.number().min(0).max(100).nullable().optional(),
    lightening_studio_notes: optionalTrimmedString,
    is_draft: z.boolean().optional().default(false),
    is_no_show: z.boolean().optional().default(false),
    zonen_id: optionalTrimmedString.nullable().optional(),
    zahlung: zahlungSchema,
};

const createSessionSchema = z.object({
    case_id: z.string({ required_error: 'case_id is required' }).trim().min(1),
    ...sessionFieldsSchema,
});

const updateSessionSchema = z
    .object({
        treatment_date: z.coerce.date().optional(),
        treatment_time: optionalTrimmedString,
        appointment_id: optionalTrimmedString.nullable().optional(),
        standort_id: optionalTrimmedString,
        standort_name: optionalTrimmedString,
        mitarbeiter_id: optionalTrimmedString,
        mitarbeiter_name: optionalTrimmedString,
        raum_id: optionalTrimmedString,
        raum_name: optionalTrimmedString,
        dauer_minuten: z.number().min(0).nullable().optional(),
        laser_id: optionalTrimmedString,
        studio_laser_brand: optionalTrimmedString,
        studio_laser_model: optionalTrimmedString,
        laser_typ: optionalTrimmedString,
        wavelength_nm: z.array(z.number().min(0)).optional(),
        fluence_j_cm2: z.number().min(0).nullable().optional(),
        spot_size_mm: z.number().min(0).nullable().optional(),
        frequency_hz: z.number().min(0).nullable().optional(),
        pass_count: z.number().min(0).nullable().optional(),
        cooling_used: z.boolean().optional(),
        endpoint_reaction: optionalTrimmedString,
        pain_score_0_10: z.number().min(0).max(10).nullable().optional(),
        adverse_event_flag: z.boolean().optional(),
        adverse_event_type: optionalTrimmedString,
        special_notes: optionalTrimmedString,
        removal_pct: z.number().min(0).max(100).nullable().optional(),
        verblassung_prozent: z.number().min(0).max(100).nullable().optional(),
        fortschritt_foto_data: optionalTrimmedString,
        image_quality_ok: z.boolean().nullable().optional(),
        photo_same_angle: z.boolean().nullable().optional(),
        photo_same_distance: z.boolean().nullable().optional(),
        photo_comparable_light: z.boolean().nullable().optional(),
        lightening_studio_pct: z.number().min(0).max(100).nullable().optional(),
        lightening_studio_notes: optionalTrimmedString,
        is_draft: z.boolean().optional(),
        is_no_show: z.boolean().optional(),
        zonen_id: optionalTrimmedString.nullable().optional(),
        zahlung: zahlungSchema,
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required to update',
    });

const listSessionsQuerySchema = z.object({
    ...paginationQueryFields,
    case_id: z.string().trim().optional(),
    customer_id: z.string().trim().optional(),
    zonen_id: z.string().trim().optional(),
    is_draft: z.enum(['true', 'false']).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
});

module.exports = {
    createSessionSchema,
    updateSessionSchema,
    listSessionsQuerySchema,
};

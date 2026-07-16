const { z } = require('zod');
const {
    APPOINTMENT_STATUS,
    APPOINTMENT_TYPE,
} = require('../config/constants');
const { paginationQueryFields } = require('./paginationValidator');
const { preSessionCheckSchema } = require('./caseValidator');

const appointmentTypeEnum = z.enum([
    APPOINTMENT_TYPE.BERATUNG,
    APPOINTMENT_TYPE.TREATMENT,
    APPOINTMENT_TYPE.FIRST,
]);

const appointmentStatusEnum = z.enum(Object.values(APPOINTMENT_STATUS));

const optionalTrimmedString = z.string().trim().optional();

const bookingPrecheckPayloadSchema = z.object({
    pre_session: preSessionCheckSchema.optional().default({}),
    ko_answers: z.record(z.enum(['changed', 'still'])).optional().default({}),
    wiederholungen: z
        .record(
            z.object({
                aktuell_gleich: z.boolean(),
                aenderung: z.string().optional().default(''),
            })
        )
        .optional()
        .default({}),
    wiederholungen_confirmed: z.boolean().optional().default(false),
    ko_signature: z
        .object({
            unterschrift_data: z.string().min(1),
        })
        .optional(),
});

const createAppointmentSchema = z.object({
    case_id: z.string({ required_error: 'case_id is required' }).trim().min(1),
    date: z.coerce.date({ required_error: 'date is required' }),
    time: z.string({ required_error: 'time is required' }).trim().min(1, 'time is required'),
    type: appointmentTypeEnum.optional(),
    consultationOnly: z.boolean().optional().default(false),
    dauer_minuten: z.number().min(0).nullable().optional(),
    standort_id: optionalTrimmedString.default(''),
    standort_name: optionalTrimmedString.default(''),
    gruppen_termin: z.boolean().optional().default(false),
    gruppen_cases: z.array(z.string().trim()).optional().default([]),
    gruppen_rabatt: z.number().min(0).max(100).nullable().optional(),
    gruppen_preis_total: z.number().min(0).nullable().optional(),
    preSessionCheck: preSessionCheckSchema.optional(),
    booking_precheck: bookingPrecheckPayloadSchema.optional(),
});

const updateAppointmentSchema = z
    .object({
        date: z.coerce.date().optional(),
        time: z.string().trim().min(1).optional(),
        status: appointmentStatusEnum.optional(),
        type: appointmentTypeEnum.optional(),
        consultationOnly: z.boolean().optional(),
        dauer_minuten: z.number().min(0).nullable().optional(),
        standort_id: optionalTrimmedString,
        standort_name: optionalTrimmedString,
        gruppen_rabatt: z.number().min(0).max(100).nullable().optional(),
        gruppen_preis_total: z.number().min(0).nullable().optional(),
        preSessionCheck: preSessionCheckSchema.optional(),
        booking_precheck: bookingPrecheckPayloadSchema.optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
        message: 'At least one field is required to update',
    });

const listAppointmentsQuerySchema = z.object({
    ...paginationQueryFields,
    case_id: z.string().trim().optional(),
    customer_id: z.string().trim().optional(),
    studio_id: z.string().trim().optional(),
    status: appointmentStatusEnum.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
});

module.exports = {
    createAppointmentSchema,
    updateAppointmentSchema,
    listAppointmentsQuerySchema,
};

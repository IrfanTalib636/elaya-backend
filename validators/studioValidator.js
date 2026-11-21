const { z } = require('zod');
const { STUDIO_STATUS } = require('../config/constants');
const { WEEKDAY_KEYS, MITARBEITER_ROLLEN } = require('../config/studioDefaults');
const { paginationQueryFields } = require('./paginationValidator');

const studioStatusEnum = z.enum(Object.values(STUDIO_STATUS));

const timeSchema = z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM');

const timeToMinutesSafe = (value) => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
};

const pauseSchema = z
    .object({
        von: timeSchema,
        bis: timeSchema,
    })
    .strict()
    .refine(
        (p) => {
            const start = timeToMinutesSafe(p.von);
            const end = timeToMinutesSafe(p.bis);
            return start != null && end != null && end > start;
        },
        { message: 'Break end time must be after start time' }
    );

const dayHoursSchema = z
    .object({
        offen: z.boolean().optional(),
        von: timeSchema.optional(),
        bis: timeSchema.optional(),
        pausen: z.array(pauseSchema).max(8).optional(),
    })
    .strict();

const oeffnungszeitenSchema = z
    .object(
        Object.fromEntries(WEEKDAY_KEYS.map((key) => [key, dayHoursSchema]))
    )
    .strict()
    .partial()
    .optional();

const oeffnungsAusnahmeSchema = z
    .object({
        datum: z
            .string()
            .trim()
            .regex(/^\d{4}-\d{2}-\d{2}$/, 'datum must be YYYY-MM-DD'),
        offen: z.boolean().optional(),
        von: timeSchema.optional(),
        bis: timeSchema.optional(),
        notiz: z.string().trim().max(200).optional(),
    })
    .strict();

const standortSchema = z
    .object({
        id: z.string().trim().optional(),
        name: z.string().trim().min(1, 'Location name is required'),
        strasse: z.string().trim().optional(),
        plz: z.string().trim().optional(),
        ort: z.string().trim().optional(),
        land: z.string().trim().optional(),
        aktiv: z.boolean().optional(),
        oeffnungszeiten: oeffnungszeitenSchema,
        oeffnungs_ausnahmen: z.array(oeffnungsAusnahmeSchema).optional(),
        pufferzeit_minuten: z.number().int().min(0).max(120).nullable().optional(),
        slot_interval_minuten: z
            .union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)])
            .nullable()
            .optional(),
    })
    .strict();

const behandlungsraumSchema = z
    .object({
        id: z.string().trim().optional(),
        name: z.string().trim().min(1, 'Room name is required'),
        farbe: z.string().trim().optional(),
        aktiv: z.boolean().optional(),
        laser_brand: z.string().trim().optional(),
        laser_model: z.string().trim().optional(),
        laser_device_id: z.string().trim().nullable().optional(),
        laser_device_ids: z.array(z.string().trim().min(1)).optional(),
        standort_id: z.string().trim().optional(),
    })
    .strict();

const mitarbeiterSchema = z
    .object({
        id: z.string().trim().optional(),
        vorname: z.string().trim().min(1, 'vorname is required'),
        nachname: z.string().trim().min(1, 'nachname is required'),
        rolle: z
            .string()
            .trim()
            .min(1)
            .refine(
                (v) => MITARBEITER_ROLLEN.includes(v),
                { message: `rolle must be one of: ${MITARBEITER_ROLLEN.join(', ')}` }
            )
            .optional(),
        raum_id: z.string().trim().optional(),
        standort_id: z.string().trim().optional(),
        aktiv: z.boolean().optional(),
        user_id: z.string().trim().nullable().optional(),
    })
    .strict();

const patchStudioProfileSchema = z
    .object({
        firma: z.string().trim().min(1).optional(),
        telefon: z.string().trim().optional(),
        strasse: z.string().trim().optional(),
        plz: z.string().trim().optional(),
        ort: z.string().trim().optional(),
        land: z.string().trim().optional(),
        notizen: z.string().trim().optional(),
    })
    .strict();

const patchStudioSettingsSchema = z
    .object({
        profile: patchStudioProfileSchema.optional(),
        oeffnungszeiten: oeffnungszeitenSchema,
        oeffnungs_ausnahmen: z.array(oeffnungsAusnahmeSchema).optional(),
        standorte: z.array(standortSchema).optional(),
        behandlungsraeume: z.array(behandlungsraumSchema).optional(),
        mitarbeiter: z.array(mitarbeiterSchema).optional(),
        pufferzeit_minuten: z.number().int().min(0).max(120).optional(),
        slot_interval_minuten: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]).optional(),
    })
    .strict()
    .refine(
        (body) =>
            body.profile !== undefined ||
            body.oeffnungszeiten !== undefined ||
            body.oeffnungs_ausnahmen !== undefined ||
            body.standorte !== undefined ||
            body.behandlungsraeume !== undefined ||
            body.mitarbeiter !== undefined ||
            body.pufferzeit_minuten !== undefined ||
            body.slot_interval_minuten !== undefined,
        { message: 'At least one settings section is required' }
    );

const listAdminStudiosQuerySchema = z.object({
    ...paginationQueryFields,
    status: studioStatusEnum.optional(),
    search: z.string().trim().optional(),
});

const patchStudioStatusSchema = z
    .object({
        status: studioStatusEnum,
        notizen: z.string().trim().optional(),
    })
    .strict();

module.exports = {
    patchStudioSettingsSchema,
    patchStudioProfileSchema,
    listAdminStudiosQuerySchema,
    patchStudioStatusSchema,
};

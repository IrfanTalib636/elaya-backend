const { z } = require('zod');
const { STUDIO_STATUS } = require('../config/constants');
const { WEEKDAY_KEYS, MITARBEITER_ROLLEN } = require('../config/studioDefaults');
const { paginationQueryFields } = require('./paginationValidator');

const studioStatusEnum = z.enum(Object.values(STUDIO_STATUS));

const timeSchema = z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM');

const dayHoursSchema = z
    .object({
        offen: z.boolean().optional(),
        von: timeSchema.optional(),
        bis: timeSchema.optional(),
    })
    .strict();

const oeffnungszeitenSchema = z
    .object(
        Object.fromEntries(WEEKDAY_KEYS.map((key) => [key, dayHoursSchema]))
    )
    .strict()
    .partial()
    .optional();

const behandlungsraumSchema = z
    .object({
        id: z.string().trim().optional(),
        name: z.string().trim().min(1, 'Room name is required'),
        farbe: z.string().trim().optional(),
        aktiv: z.boolean().optional(),
        laser_brand: z.string().trim().optional(),
        laser_model: z.string().trim().optional(),
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
        aktiv: z.boolean().optional(),
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
        behandlungsraeume: z.array(behandlungsraumSchema).optional(),
        mitarbeiter: z.array(mitarbeiterSchema).optional(),
        pufferzeit_minuten: z.number().int().min(0).max(120).optional(),
    })
    .strict()
    .refine(
        (body) =>
            body.profile !== undefined ||
            body.oeffnungszeiten !== undefined ||
            body.behandlungsraeume !== undefined ||
            body.mitarbeiter !== undefined ||
            body.pufferzeit_minuten !== undefined,
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

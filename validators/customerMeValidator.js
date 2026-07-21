const { z } = require('zod');

const optionalStr = z.string().trim().optional();
const emailSchema = z
    .string()
    .trim()
    .email('Valid email is required')
    .transform((v) => v.toLowerCase());
const dateOptional = z.coerce.date().optional().nullable();

/** Customer self-service profile edit (mobile Profile tab) */
const updateCustomerMeSchema = z
    .object({
        vorname: optionalStr,
        nachname: optionalStr,
        email: emailSchema.optional(),
        telefon: optionalStr,
        geburtsdatum: dateOptional,
        strasse: optionalStr,
        plz: optionalStr,
        ort: optionalStr,
        land: optionalStr,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
        message: 'At least one field is required',
    });

module.exports = { updateCustomerMeSchema };

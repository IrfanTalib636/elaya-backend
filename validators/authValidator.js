const { z } = require('zod');
const { AKQUISE_QUELLE } = require('../config/constants');

const akquiseQuelleEnum = z.enum([
    AKQUISE_QUELLE.STUDIO_EIGEN,
    AKQUISE_QUELLE.PLATTFORM_VERMITTELT,
    AKQUISE_QUELLE.STUDIO_WECHSEL,
]);

const requiredTrimmedString = (field) =>
    z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`);

const optionalTrimmedString = z.string().trim().optional();

const passwordSchema = z.string().min(8, 'password must be at least 8 characters');

const emailSchema = z
    .string({ required_error: 'email is required' })
    .trim()
    .email('valid email is required')
    .transform((value) => value.toLowerCase());

const standortSchema = z.object({
    name: requiredTrimmedString('standort name'),
    strasse: optionalTrimmedString.default(''),
    plz: optionalTrimmedString.default(''),
    ort: optionalTrimmedString.default(''),
    land: optionalTrimmedString.default('Schweiz'),
});

const registerCustomerSchema = z.object({
    vorname: requiredTrimmedString('vorname'),
    nachname: requiredTrimmedString('nachname'),
    email: emailSchema,
    telefon: requiredTrimmedString('telefon'),
    password: passwordSchema,
    studio_code: requiredTrimmedString('studio_code'),
    geburtsdatum: z.coerce.date().optional().nullable(),
    strasse: optionalTrimmedString.default(''),
    plz: optionalTrimmedString.default(''),
    ort: optionalTrimmedString.default(''),
    land: optionalTrimmedString.default('Schweiz'),
    akquise_quelle: akquiseQuelleEnum.optional(),
});

const registerStudioSchema = z.object({
    firma: requiredTrimmedString('firma'),
    studio_code: requiredTrimmedString('studio_code'),
    email: emailSchema,
    telefon: optionalTrimmedString.default(''),
    password: passwordSchema,
    strasse: optionalTrimmedString.default(''),
    plz: optionalTrimmedString.default(''),
    ort: optionalTrimmedString.default(''),
    land: optionalTrimmedString.default('Schweiz'),
    standorte: z.array(standortSchema).optional().default([]),
});

const loginSchema = z.object({
    email: emailSchema,
    password: z.string().min(1, 'password is required'),
});

const forgotPasswordSchema = z.object({
    email: emailSchema,
    portal: z.enum(['studio', 'admin', 'customer']).optional().default('studio'),
});

const resetPasswordSchema = z.object({
    token: z.string().trim().min(1, 'token is required'),
    password: passwordSchema,
});

module.exports = {
    registerCustomerSchema,
    registerStudioSchema,
    loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
};

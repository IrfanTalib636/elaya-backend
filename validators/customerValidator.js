const { z } = require('zod');
const { AKQUISE_QUELLE, PIPELINE_STUFE } = require('../config/constants');
const { paginationQueryFields } = require('./paginationValidator');

const optionalStr  = z.string().trim().optional();
const requiredStr  = (field) => z.string({ required_error: `${field} is required` }).trim().min(1, `${field} is required`);
const emailSchema  = z.string().trim().email('Valid email is required').transform((v) => v.toLowerCase());
const dateOptional = z.coerce.date().optional().nullable();

const pipelineEnum   = z.enum(Object.values(PIPELINE_STUFE)).optional();
const akquiseEnum    = z.enum(Object.values(AKQUISE_QUELLE)).optional();

const createCustomerSchema = z.object({
    vorname:      requiredStr('vorname'),
    nachname:     requiredStr('nachname'),
    email:        emailSchema,
    telefon:      requiredStr('telefon'),
    geburtsdatum: dateOptional,
    strasse:      optionalStr.default(''),
    plz:          optionalStr.default(''),
    ort:          optionalStr.default(''),
    land:         optionalStr.default('Schweiz'),
    notizen:      optionalStr.default(''),
    studio_id:    optionalStr,
});

const updateCustomerSchema = z.object({
    vorname:          optionalStr,
    nachname:         optionalStr,
    email:            emailSchema.optional(),
    telefon:          optionalStr,
    geburtsdatum:     dateOptional,
    strasse:          optionalStr,
    plz:              optionalStr,
    ort:              optionalStr,
    land:             optionalStr,
    notizen:          optionalStr,
    pipeline_stufe:   pipelineEnum,
    akquise_quelle:   akquiseEnum,
    aktuelle_firma_id: optionalStr,
}).strict();

const listCustomersQuerySchema = z.object({
    search:         optionalStr,
    pipeline_stufe: pipelineEnum,
    ...paginationQueryFields,
});

module.exports = { createCustomerSchema, updateCustomerSchema, listCustomersQuerySchema };

const { z } = require('zod');
const { paginationQueryFields } = require('./paginationValidator');

const objectId = z
    .string()
    .trim()
    .min(1)
    .refine((v) => /^[a-fA-F0-9]{24}$/.test(v), { message: 'Invalid id' });

const nachsorgePhotoCheckSchema = z
    .object({
        case_id: objectId,
        foto_file_id: objectId,
        sitzungs_datum: z.coerce.date().optional().nullable(),
    })
    .strict();

const nachsorgeCheckSchema = z
    .object({
        case_id: objectId,
        foto_file_id: objectId,
        symptome: z.array(z.string().trim().min(1)).default([]),
        sitzungs_datum: z.coerce.date().optional().nullable(),
    })
    .strict();

const listNachsorgeQuerySchema = z.object({
    case_id: objectId.optional(),
    ...paginationQueryFields,
});

module.exports = {
    nachsorgePhotoCheckSchema,
    nachsorgeCheckSchema,
    listNachsorgeQuerySchema,
};

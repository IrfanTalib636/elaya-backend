const { z } = require('zod');

const objectId = z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, 'must be a valid id');

/** Swagger often sends "" for optional fields — treat as omitted */
const optionalObjectId = z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    objectId.optional()
);

const verblassungAnalyzeSchema = z
    .object({
        session_id: objectId,
        foto_vorher_file_id: optionalObjectId,
        foto_aktuell_file_id: optionalObjectId,
        persist: z.boolean().optional().default(true),
    })
    .strict();

module.exports = {
    verblassungAnalyzeSchema,
};

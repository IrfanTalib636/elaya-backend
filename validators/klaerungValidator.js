const { z } = require('zod');
const { STUDIO_FREIGABE_STATUS } = require('../config/constants');

const klaerungStatusEnum = z.enum(['offen', 'in_klaerung', 'geklaert']);

const updateKlaerungSchema = z.object({
    frage_key: z
        .string()
        .trim()
        .regex(/^F\d+$/, 'frage_key must be like F3, F11'),
    status: klaerungStatusEnum,
    notiz: z.string().trim().optional().default(''),
});

const updateStudioFreigabeSchema = z.object({
    status: z.enum([
        STUDIO_FREIGABE_STATUS.FREIGEGEBEN,
        STUDIO_FREIGABE_STATUS.ABGLEHNT,
        STUDIO_FREIGABE_STATUS.AUSSTEHEND,
    ]),
    notiz: z.string().trim().optional().default(''),
    grund: z.string().trim().optional().default(''),
});

module.exports = {
    updateKlaerungSchema,
    updateStudioFreigabeSchema,
    klaerungStatusEnum,
};

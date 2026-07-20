const { z } = require('zod');
const { STUDIO_TRANSFER_STATUS } = require('../config/constants');
const { MAX_SIGNATURE_BYTES } = require('./signatureValidator');
const { paginationQueryFields } = require('./paginationValidator');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

const createStudioTransferSchema = z.object({
    zu_firma_id: objectId,
    einwilligung_akte: z.literal(true, {
        errorMap: () => ({ message: 'einwilligung_akte must be true' }),
    }),
    einwilligung_datenschutz: z.literal(true, {
        errorMap: () => ({ message: 'einwilligung_datenschutz must be true' }),
    }),
    einwilligung_bestaetigung: z.literal(true, {
        errorMap: () => ({ message: 'einwilligung_bestaetigung must be true' }),
    }),
    einwilligung_unterschrift: z
        .string()
        .min(1, 'Signature is required')
        .refine(
            (v) =>
                /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(v) ||
                /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 64)),
            'Signature must be a base64 image data URI'
        )
        .refine((v) => Buffer.byteLength(v, 'utf8') <= MAX_SIGNATURE_BYTES, {
            message: `Signature image exceeds ${MAX_SIGNATURE_BYTES} bytes`,
        }),
});

const listStudioTransfersQuerySchema = z.object({
    ...paginationQueryFields,
    status: z.enum(Object.values(STUDIO_TRANSFER_STATUS)).optional(),
});

const rejectStudioTransferSchema = z.object({
    ablehnungsgrund: z.string().trim().min(1, 'Rejection reason is required').max(1000),
});

module.exports = {
    createStudioTransferSchema,
    listStudioTransfersQuerySchema,
    rejectStudioTransferSchema,
};

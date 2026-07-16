const { z } = require('zod');

const MAX_SIGNATURE_BYTES = 64 * 1024;
const MAX_PDF_BYTES = 2 * 1024 * 1024;

const base64DataUri = z
    .string()
    .min(1)
    .refine(
        (v) =>
            /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(v) ||
            /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 64)),
        'unterschrift_data must be a base64 JPEG/PNG data URI or raw base64'
    )
    .refine((v) => Buffer.byteLength(v, 'utf8') <= MAX_SIGNATURE_BYTES, {
        message: `Signature image exceeds ${MAX_SIGNATURE_BYTES} bytes`,
    });

const pdfDataUri = z
    .string()
    .optional()
    .refine((v) => !v || v.length <= MAX_PDF_BYTES, {
        message: `merkblatt_pdf exceeds ${MAX_PDF_BYTES} bytes`,
    });

const submitSignatureSchema = z.object({
    merkblatt_gelesen: z.literal(true, {
        errorMap: () => ({ message: 'merkblatt_gelesen must be true' }),
    }),
    bestaetigung_text: z.union([z.literal(true), z.string().min(1)]),
    unterschrift_data: base64DataUri,
    merkblatt_pdf: pdfDataUri,
});

const merkblattQuerySchema = z.object({
    locale: z.enum(['de', 'en']).optional().default('de'),
});

module.exports = {
    submitSignatureSchema,
    merkblattQuerySchema,
    MAX_SIGNATURE_BYTES,
    MAX_PDF_BYTES,
};

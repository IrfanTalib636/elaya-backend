const { z } = require('zod');
const { preSessionCheckSchema } = require('./caseValidator');

const koAnswerEnum = z.enum(['changed', 'still']);

const wiederholungEntrySchema = z.object({
    aktuell_gleich: z.boolean(),
    aenderung: z.string().optional().default(''),
});

const koSignatureSchema = z.object({
    unterschrift_data: z.string().min(1, 'Signature data is required'),
});

const bookingPrecheckBodySchema = z.object({
    consultation_only: z.boolean().optional().default(false),
    pre_session: preSessionCheckSchema.optional().default({}),
    ko_answers: z.record(koAnswerEnum).optional().default({}),
    wiederholungen: z.record(wiederholungEntrySchema).optional().default({}),
    wiederholungen_confirmed: z.boolean().optional().default(false),
    ko_signature: koSignatureSchema.optional(),
});

module.exports = {
    bookingPrecheckBodySchema,
};

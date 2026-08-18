const { z } = require('zod');

const objectId = z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, 'must be a valid id');

const optionalObjectId = z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    objectId.optional()
);

const historyMessageSchema = z
    .object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
    })
    .strict();

const chatMessageSchema = z
    .object({
        message: z.string().trim().min(1, 'message is required').max(4000),
        case_id: optionalObjectId,
        customer_id: optionalObjectId,
        history: z.array(historyMessageSchema).max(20).optional().default([]),
    })
    .strict();

module.exports = {
    chatMessageSchema,
};

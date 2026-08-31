const { z } = require('zod');

const listNotificationsSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    before: z.string().trim().min(1).optional(),
});

const markConversationReadSchema = z.object({
    conversation_id: z
        .string({ required_error: 'conversation_id is required' })
        .trim()
        .min(1, 'conversation_id is required'),
});

module.exports = {
    listNotificationsSchema,
    markConversationReadSchema,
};

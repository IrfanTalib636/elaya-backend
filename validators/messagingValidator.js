const { z } = require('zod');

const objectId = z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, 'must be a valid id');

const optionalObjectId = z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    objectId.optional()
);

const createConversationSchema = z
    .object({
        customer_id: optionalObjectId,
        studio_id: optionalObjectId,
    })
    .strict();

const sendLiveChatMessageSchema = z
    .object({
        text: z.string().trim().min(1, 'text is required').max(4000),
        case_id: optionalObjectId,
    })
    .strict();

const markReadSchema = z
    .object({
        up_to_message_id: optionalObjectId,
    })
    .strict();

const pinConversationSchema = z
    .object({
        pinned: z.boolean(),
    })
    .strict();

const deleteConversationsSchema = z
    .object({
        conversation_ids: z
            .array(objectId)
            .min(1, 'conversation_ids is required')
            .max(100, 'At most 100 conversations can be deleted at once'),
    })
    .strict();

module.exports = {
    createConversationSchema,
    sendLiveChatMessageSchema,
    markReadSchema,
    pinConversationSchema,
    deleteConversationsSchema,
};

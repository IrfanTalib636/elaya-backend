const { z } = require('zod');

const openPlatformConversationSchema = z.object({
    studio_id: z.string().min(1).optional(),
    studioId: z.string().min(1).optional(),
});

const sendPlatformMessageSchema = z.object({
    text: z.string().trim().min(1).max(4000),
});

const markPlatformReadSchema = z.object({}).passthrough();

module.exports = {
    openPlatformConversationSchema,
    sendPlatformMessageSchema,
    markPlatformReadSchema,
};

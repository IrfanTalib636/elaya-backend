const { z } = require('zod');

const registerPushTokenSchema = z.object({
    token: z
        .string({ required_error: 'token is required' })
        .trim()
        .min(1, 'token is required'),
    platform: z.enum(['ios', 'android']).optional(),
});

const removePushTokenSchema = z.object({
    token: z
        .string({ required_error: 'token is required' })
        .trim()
        .min(1, 'token is required'),
});

module.exports = {
    registerPushTokenSchema,
    removePushTokenSchema,
};

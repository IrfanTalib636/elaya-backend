const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');
const {
    openPlatformConversationSchema,
    sendPlatformMessageSchema,
    markPlatformReadSchema,
} = require('../validators/platformMessagingValidator');
const {
    listInbox,
    openConversation,
    getConversation,
    listMessages,
    sendMessage,
    markRead,
} = require('../controllers/platformMessagingController');

const router = express.Router();

const ROLES = [
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * Platform (super admin) ↔ studio live chat.
 * Separate from customer ↔ studio `/messaging`.
 */
router.get('/conversations', protect, authorize(...ROLES), listInbox);

router.post(
    '/conversations',
    protect,
    authorize(...ROLES),
    validateMiddleware(openPlatformConversationSchema),
    openConversation
);

router.get(
    '/conversations/:conversationId',
    protect,
    authorize(...ROLES),
    getConversation
);

router.get(
    '/conversations/:conversationId/messages',
    protect,
    authorize(...ROLES),
    listMessages
);

router.post(
    '/conversations/:conversationId/messages',
    protect,
    authorize(...ROLES),
    validateMiddleware(sendPlatformMessageSchema),
    sendMessage
);

router.post(
    '/conversations/:conversationId/read',
    protect,
    authorize(...ROLES),
    validateMiddleware(markPlatformReadSchema),
    markRead
);

module.exports = router;

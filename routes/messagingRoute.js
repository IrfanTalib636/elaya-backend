const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');
const {
    createConversationSchema,
    sendLiveChatMessageSchema,
    markReadSchema,
} = require('../validators/messagingValidator');
const {
    listConversations,
    createOrGetConversation,
    getConversation,
    listMessages,
    sendMessage,
    markRead,
} = require('../controllers/messagingController');

const router = express.Router();

const MESSAGING_ROLES = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * tags:
 *   name: Messaging
 *   description: |
 *     Studio ↔ customer **live chat** (human staff). Separate from AI FAB `POST /chat`.
 *     Pair with Socket.io events under namespace default path `/socket.io`
 *     (auth via `handshake.auth.token` = access JWT).
 */

/**
 * @swagger
 * /messaging/conversations:
 *   get:
 *     summary: List live-chat conversations
 *     tags: [Messaging]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Conversation inbox
 *   post:
 *     summary: Get or create conversation with current studio (customer) or a customer (studio)
 *     tags: [Messaging]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               customer_id: { type: string, description: Required for studio callers }
 *               studio_id: { type: string, description: Admin only }
 *     responses:
 *       200:
 *         description: Conversation
 */
router.get(
    '/conversations',
    protect,
    authorize(...MESSAGING_ROLES),
    listConversations
);

router.post(
    '/conversations',
    protect,
    authorize(...MESSAGING_ROLES),
    validateMiddleware(createConversationSchema),
    createOrGetConversation
);

/**
 * @swagger
 * /messaging/conversations/{conversationId}:
 *   get:
 *     summary: Get one conversation
 *     tags: [Messaging]
 *     security:
 *       - bearerAuth: []
 */
router.get(
    '/conversations/:conversationId',
    protect,
    authorize(...MESSAGING_ROLES),
    getConversation
);

/**
 * @swagger
 * /messaging/conversations/{conversationId}/messages:
 *   get:
 *     summary: List messages (newest page; optional before_id cursor)
 *     tags: [Messaging]
 *     security:
 *       - bearerAuth: []
 *   post:
 *     summary: Send a message (also emits Socket.io messaging:message)
 *     tags: [Messaging]
 *     security:
 *       - bearerAuth: []
 */
router.get(
    '/conversations/:conversationId/messages',
    protect,
    authorize(...MESSAGING_ROLES),
    listMessages
);

router.post(
    '/conversations/:conversationId/messages',
    protect,
    authorize(...MESSAGING_ROLES),
    validateMiddleware(sendLiveChatMessageSchema),
    sendMessage
);

/**
 * @swagger
 * /messaging/conversations/{conversationId}/read:
 *   post:
 *     summary: Mark conversation messages as read
 *     tags: [Messaging]
 *     security:
 *       - bearerAuth: []
 */
router.post(
    '/conversations/:conversationId/read',
    protect,
    authorize(...MESSAGING_ROLES),
    validateMiddleware(markReadSchema),
    markRead
);

module.exports = router;

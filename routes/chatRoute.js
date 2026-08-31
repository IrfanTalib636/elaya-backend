const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const aiRateLimiter = require('../middleware/aiRateLimiter');
const { sendChat } = require('../controllers/chatController');
const { chatMessageSchema } = require('../validators/chatValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const CHAT_ROLES = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Elaya FAB AI assistant. Anthropic key is server-side only.
 */

/**
 * @swagger
 * /chat:
 *   post:
 *     summary: Send a message to Elaya AI assistant (FAB)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio, admin
 *
 *       Server builds profile/case context (lockouts, sessions, ampel) and calls Claude.
 *       Customers may earn `erster_elaya_chat` (+30, einmalig).
 *       Optional `history` = last turns from the client (max 20; server uses last 10).
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message:
 *                 type: string
 *                 example: Wann kann ich den nächsten Termin buchen?
 *               customer_id:
 *                 type: string
 *                 nullable: true
 *                 description: Studio only — focus context on one customer
 *               case_id:
 *                 type: string
 *                 nullable: true
 *                 description: Focus context on one case (optional)
 *               history:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role: { type: string, enum: [user, assistant] }
 *                     content: { type: string }
 *     responses:
 *       200:
 *         description: Assistant reply
 *       503:
 *         description: AI disabled — soft fallback reply still returned for missing key path
 */
router.post(
    '/',
    protect,
    authorize(...CHAT_ROLES),
    aiRateLimiter,
    validateMiddleware(chatMessageSchema),
    sendChat
);

module.exports = router;

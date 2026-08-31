const express = require('express');
const notificationController = require('../controllers/notificationController');
const validateMiddleware = require('../middleware/validateMiddleware');
const {
    listNotificationsSchema,
    markConversationReadSchema,
} = require('../validators/notificationValidator');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List in-app notifications (newest first)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 50 }
 *       - in: query
 *         name: before
 *         schema: { type: string }
 *         description: Cursor — return items older than this notification id
 *     responses:
 *       200:
 *         description: Notification list
 */
router.get(
    '/',
    validateMiddleware(listNotificationsSchema, 'query'),
    notificationController.listNotifications
);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Unread notification count (header badge)
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Unread count
 */
router.get('/unread-count', notificationController.getUnreadCount);

/**
 * @swagger
 * /notifications/read-all:
 *   post:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Cleared
 */
router.post('/read-all', notificationController.markAllNotificationsRead);

/**
 * @swagger
 * /notifications/read-conversation:
 *   post:
 *     summary: Mark all notifications for a conversation as read
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [conversation_id]
 *             properties:
 *               conversation_id: { type: string }
 *     responses:
 *       200:
 *         description: Conversation notifications marked read
 */
router.post(
    '/read-conversation',
    validateMiddleware(markConversationReadSchema),
    notificationController.markConversationNotificationsRead
);

/**
 * @swagger
 * /notifications/{id}/read:
 *   patch:
 *     summary: Mark one notification as read
 *     tags: [Notifications]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated notification
 *       404:
 *         description: Not found
 */
router.patch('/:id/read', notificationController.markNotificationRead);

module.exports = router;

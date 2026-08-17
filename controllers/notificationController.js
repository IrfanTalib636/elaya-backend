const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const notificationService = require('../services/notificationService');

/**
 * GET /notifications — newest-first inbox for the authenticated user.
 */
const listNotifications = asyncHandler(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const before = req.query.before || undefined;
    const notifications = await notificationService.listForUser(req.user._id, {
        limit,
        before,
    });

    res.status(200).json({
        success: true,
        message: 'Notifications fetched',
        data: { notifications },
    });
});

/**
 * GET /notifications/unread-count — badge for the header bell.
 */
const getUnreadCount = asyncHandler(async (req, res) => {
    const unread_count = await notificationService.unreadCountForUser(
        req.user._id
    );

    res.status(200).json({
        success: true,
        message: 'Unread count fetched',
        data: { unread_count },
    });
});

/**
 * PATCH /notifications/:id/read — mark one notification as read.
 */
const markNotificationRead = asyncHandler(async (req, res) => {
    const notification = await notificationService.markRead(
        req.user._id,
        req.params.id
    );
    if (!notification) {
        throw new ApiError(404, 'Notification not found');
    }

    res.status(200).json({
        success: true,
        message: 'Notification marked as read',
        data: { notification },
    });
});

/**
 * POST /notifications/read-all — clear the unread badge.
 */
const markAllNotificationsRead = asyncHandler(async (req, res) => {
    const result = await notificationService.markAllRead(req.user._id);

    res.status(200).json({
        success: true,
        message: 'All notifications marked as read',
        data: result,
    });
});

/**
 * POST /notifications/read-conversation — mark all for a conversation read
 * (used when opening studio live chat from a push or the inbox).
 */
const markConversationNotificationsRead = asyncHandler(async (req, res) => {
    const { conversation_id: conversationId } = req.body;
    const result = await notificationService.markConversationRead(
        req.user._id,
        conversationId
    );

    res.status(200).json({
        success: true,
        message: 'Conversation notifications marked as read',
        data: result,
    });
});

module.exports = {
    listNotifications,
    getUnreadCount,
    markNotificationRead,
    markAllNotificationsRead,
    markConversationNotificationsRead,
};

const AppNotification = require('../models/appNotificationModel');

const PUSH_BODY_MAX = 178;

const truncateBody = (text) => {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
    if (cleaned.length <= PUSH_BODY_MAX) return cleaned;
    return `${cleaned.slice(0, PUSH_BODY_MAX - 1)}…`;
};

const serialize = (doc) => ({
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    conversation_id: doc.conversation ? String(doc.conversation) : null,
    case_id: doc.case_id ? String(doc.case_id) : null,
    message_id: doc.message ? String(doc.message) : null,
    read_at: doc.read_at ? new Date(doc.read_at).toISOString() : null,
    unread: !doc.read_at,
    createdAt: doc.createdAt ? new Date(doc.createdAt).toISOString() : null,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : null,
});

/**
 * Persist inbox rows for recipients (one per user). Used by pushService so
 * the mobile Mitteilungen list stays in sync with delivered pushes.
 */
const createForUsers = async ({
    userIds,
    type,
    title,
    body,
    conversationId = null,
    caseId = null,
    messageId = null,
}) => {
    if (!userIds?.length) return [];

    const docs = userIds.map((userId) => ({
        user: userId,
        type,
        title,
        body: truncateBody(body),
        conversation: conversationId || null,
        case_id: caseId || null,
        message: messageId || null,
    }));

    const created = await AppNotification.insertMany(docs, { ordered: false });
    return created.map(serialize);
};

const listForUser = async (userId, { limit = 50, before } = {}) => {
    const filter = { user: userId };
    if (before) {
        filter._id = { $lt: before };
    }

    const rows = await AppNotification.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))
        .lean();

    return rows.map(serialize);
};

const unreadCountForUser = async (userId) =>
    AppNotification.countDocuments({ user: userId, read_at: null });

const markRead = async (userId, notificationId) => {
    const doc = await AppNotification.findOneAndUpdate(
        { _id: notificationId, user: userId, read_at: null },
        { $set: { read_at: new Date() } },
        { new: true }
    ).lean();

    if (!doc) {
        const existing = await AppNotification.findOne({
            _id: notificationId,
            user: userId,
        }).lean();
        return existing ? serialize(existing) : null;
    }
    return serialize(doc);
};

/** Mark every unread inbox item for a conversation (e.g. opened live chat). */
const markConversationRead = async (userId, conversationId) => {
    if (!conversationId) return { modified: 0 };
    const result = await AppNotification.updateMany(
        {
            user: userId,
            conversation: conversationId,
            read_at: null,
        },
        { $set: { read_at: new Date() } }
    );
    return { modified: result.modifiedCount || 0 };
};

const markAllRead = async (userId) => {
    const result = await AppNotification.updateMany(
        { user: userId, read_at: null },
        { $set: { read_at: new Date() } }
    );
    return { modified: result.modifiedCount || 0 };
};

module.exports = {
    createForUsers,
    listForUser,
    unreadCountForUser,
    markRead,
    markConversationRead,
    markAllRead,
    serialize,
};

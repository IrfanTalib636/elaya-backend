/**
 * Expo push notifications for the customer mobile app.
 *
 * Tokens are collected per signed-in device on `User.push_tokens` (see
 * routes/pushTokenRoute.js). Delivery goes through the Expo Push Service
 * (expo-server-sdk); Expo forwards to FCM (Android) and APNs (iOS) using the
 * credentials stored on the expo.dev project.
 *
 * All sends are best effort: a failed push must never break the calling
 * request, so callers should fire-and-forget (`notifyChatMessage(...).catch`).
 */
const { Expo } = require('expo-server-sdk');
const User = require('../models/userModel');
const { getIO } = require('../sockets/io');
const { CHAT_SENDER_ROLE } = require('../config/constants');
const notificationService = require('./notificationService');

const expo = new Expo();

// Expo recommends checking receipts ~15 min after sending: only receipts
// reveal APNs/FCM-level failures such as uninstalled apps.
const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;

const PUSH_BODY_MAX = 178;

const truncateBody = (text) => {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
    if (cleaned.length <= PUSH_BODY_MAX) return cleaned;
    return `${cleaned.slice(0, PUSH_BODY_MAX - 1)}…`;
};

/** Drop tokens Expo reported as dead so we stop sending to them. */
const removeTokens = async (tokens) => {
    if (!tokens.length) return;
    try {
        await User.updateMany(
            { 'push_tokens.token': { $in: tokens } },
            { $pull: { push_tokens: { token: { $in: tokens } } } }
        );
    } catch (err) {
        console.error('Push token cleanup failed:', err.message);
    }
};

/** @param {Map<string, string>} tokenByReceiptId receiptId -> push token */
const scheduleReceiptCheck = (tokenByReceiptId) => {
    if (!tokenByReceiptId.size) return;
    const timer = setTimeout(async () => {
        try {
            const receiptIds = [...tokenByReceiptId.keys()];
            const invalid = [];
            for (const chunk of expo.chunkPushNotificationReceiptIds(receiptIds)) {
                const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
                for (const [id, receipt] of Object.entries(receipts)) {
                    if (
                        receipt.status === 'error' &&
                        receipt.details?.error === 'DeviceNotRegistered'
                    ) {
                        invalid.push(tokenByReceiptId.get(id));
                    }
                }
            }
            await removeTokens(invalid.filter(Boolean));
        } catch (err) {
            console.error('Push receipt check failed:', err.message);
        }
    }, RECEIPT_CHECK_DELAY_MS);
    // Do not keep the process alive just for receipt checks.
    if (typeof timer.unref === 'function') timer.unref();
};

/**
 * Send a push notification to every registered device of the given users.
 * @param {Array} userIds
 * @param {{title: string, body: string, data?: object}} content
 */
const sendToUsers = async (userIds, { title, body, data = {} }) => {
    if (!userIds.length) return;

    const users = await User.find({
        _id: { $in: userIds },
        'push_tokens.0': { $exists: true },
    })
        .select('push_tokens')
        .lean();

    const messages = [];
    for (const user of users) {
        for (const entry of user.push_tokens || []) {
            if (!Expo.isExpoPushToken(entry.token)) continue;
            messages.push({
                to: entry.token,
                sound: 'default',
                title,
                body: truncateBody(body),
                data,
                channelId: 'default',
            });
        }
    }
    if (!messages.length) return;

    const invalid = [];
    const tokenByReceiptId = new Map();

    for (const chunk of expo.chunkPushNotifications(messages)) {
        try {
            const tickets = await expo.sendPushNotificationsAsync(chunk);
            tickets.forEach((ticket, i) => {
                if (ticket.status === 'error') {
                    if (ticket.details?.error === 'DeviceNotRegistered') {
                        invalid.push(chunk[i].to);
                    } else {
                        console.error('Expo push ticket error:', ticket.message);
                    }
                } else if (ticket.id) {
                    tokenByReceiptId.set(ticket.id, chunk[i].to);
                }
            });
        } catch (err) {
            console.error('Expo push send failed:', err.message);
        }
    }

    await removeTokens(invalid);
    scheduleReceiptCheck(tokenByReceiptId);
};

/**
 * True when at least one socket is in BOTH rooms — i.e. a device of the
 * recipient side currently has the conversation open (live chat visible),
 * so a push would be redundant noise.
 */
const isRecipientViewingConversation = (conversationRoom, recipientRoom) => {
    try {
        const io = getIO();
        if (!io) return false;
        const inConversation = io.sockets.adapter.rooms.get(conversationRoom);
        const recipientSockets = io.sockets.adapter.rooms.get(recipientRoom);
        if (!inConversation || !recipientSockets) return false;
        for (const socketId of recipientSockets) {
            if (inConversation.has(socketId)) return true;
        }
        return false;
    } catch {
        return false;
    }
};

/**
 * Push for a new live-chat message (also covers system messages such as the
 * estimate confirmation, which are sent through the same messaging pipeline).
 * Expects the `{ message, conversation }` payload produced by
 * messagingService.sendMessage.
 */
const notifyChatMessage = async ({ message, conversation }) => {
    if (!message || !conversation) return;

    const conversationRoom = `conversation:${conversation.id}`;
    const customerId = conversation.customer?.id || message.customer_id;
    const studioId = conversation.studio?.id || message.studio_id;

    let recipients;
    let recipientRoom;
    let title;

    if (message.sender_role === CHAT_SENDER_ROLE.CUSTOMER) {
        // Customer wrote → notify studio staff devices (if any are registered).
        if (!studioId) return;
        recipientRoom = `studio:${studioId}`;
        const name = [conversation.customer?.vorname, conversation.customer?.nachname]
            .filter(Boolean)
            .join(' ');
        title = name ? `Neue Nachricht von ${name}` : 'Neue Nachricht';
        recipients = await User.find({ studio_id: studioId }).select('_id').lean();
    } else {
        // Studio or system wrote → notify the customer's devices.
        if (!customerId) return;
        recipientRoom = `user:customer:${customerId}`;
        title = conversation.studio?.firma || 'Elaya';
        recipients = await User.find({ customer_id: customerId }).select('_id').lean();
    }

    if (!recipients.length) return;
    if (isRecipientViewingConversation(conversationRoom, recipientRoom)) return;

    const recipientIds = recipients.map((u) => u._id);
    const conversationId = String(conversation.id);
    const caseId = message.case_id ? String(message.case_id) : null;
    const data = {
        type: 'chat',
        conversation_id: conversationId,
        case_id: caseId,
    };

    // Inbox row first so the Mitteilungen screen stays consistent even if
    // Expo delivery fails; never let persistence block the push send.
    try {
        await notificationService.createForUsers({
            userIds: recipientIds,
            type: 'chat',
            title,
            body: message.text,
            conversationId: conversation.id,
            caseId: message.case_id || null,
            messageId: message.id || message._id || null,
        });
    } catch (err) {
        console.error('In-app notification create failed:', err.message);
    }

    await sendToUsers(recipientIds, {
        title,
        body: message.text,
        data,
    });
};

module.exports = {
    sendToUsers,
    notifyChatMessage,
};

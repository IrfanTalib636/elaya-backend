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
const {
    CHAT_SENDER_ROLE,
    PLATFORM_CHAT_SENDER_ROLE,
    USER_ROLES,
} = require('../config/constants');
const notificationService = require('./notificationService');
const platformMessagingService = require('./platformMessagingService');

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

/**
 * Inbox + push when Elaya admin approves or rejects a studio transfer.
 * Approve also notifies the source studio (customer left) and target studio
 * (customer joined). Reject notifies the customer only.
 * Fire-and-forget from studioTransferController (`…catch`).
 */
const notifyStudioTransferDecision = async ({ customerId, transfer, approved }) => {
    if (!customerId || !transfer) return;

    const transferId = String(transfer.id || transfer._id);
    const studioName = transfer.zu_firma_name || 'Studio';
    const customerName = String(transfer.kunde_name || '').trim() || 'Customer';
    const fromName = transfer.von_firma_name || 'previous studio';
    const toName = transfer.zu_firma_name || 'new studio';

    // ── Customer (approve + reject) ──────────────────────────────────────
    const customerUsers = await User.find({ customer_id: customerId })
        .select('_id')
        .lean();
    if (customerUsers.length) {
        const recipientIds = customerUsers.map((u) => u._id);
        const type = approved
            ? 'studio_transfer_approved'
            : 'studio_transfer_rejected';
        const title = approved
            ? 'Studio-Wechsel genehmigt'
            : 'Studio-Wechsel abgelehnt';
        const body = approved
            ? `Dein Studio ist jetzt ${studioName}. Tippe, um dein Profil zu öffnen.`
            : transfer.ablehnungsgrund
              ? `Dein Studio-Wechsel wurde abgelehnt: ${transfer.ablehnungsgrund}`
              : 'Dein Studio-Wechsel wurde abgelehnt. Tippe für Details.';
        const data = {
            type,
            transfer_id: transferId,
            status: transfer.status,
            zu_firma_name: studioName,
            ablehnungsgrund: transfer.ablehnungsgrund || '',
        };

        try {
            await notificationService.createForUsers({
                userIds: recipientIds,
                type,
                title,
                body,
                studioTransferId: transferId,
            });
        } catch (err) {
            console.error('Studio transfer customer notification failed:', err.message);
        }

        await sendToUsers(recipientIds, { title, body, data });
    }

    // Reject stops here — studios are not notified.
    if (!approved) return;

    // ── Source studio: customer left ─────────────────────────────────────
    const fromStudioId = transfer.von_firma_id;
    if (fromStudioId) {
        const leftUsers = await User.find({ studio_id: fromStudioId })
            .select('_id')
            .lean();
        if (leftUsers.length) {
            const recipientIds = leftUsers.map((u) => u._id);
            const type = 'studio_transfer_left';
            const title = 'Customer left studio';
            const body = `${customerName} has switched from your studio to ${toName}.`;
            const data = {
                type,
                transfer_id: transferId,
                studio_id: String(fromStudioId),
                customer_name: customerName,
            };

            try {
                await notificationService.createForUsers({
                    userIds: recipientIds,
                    type,
                    title,
                    body,
                    studioTransferId: transferId,
                    studioId: fromStudioId,
                });
            } catch (err) {
                console.error('Studio transfer left notification failed:', err.message);
            }

            await sendToUsers(recipientIds, { title, body, data });
        }
    }

    // ── Target studio: customer joined ───────────────────────────────────
    const toStudioId = transfer.zu_firma_id;
    if (toStudioId) {
        const joinedUsers = await User.find({ studio_id: toStudioId })
            .select('_id')
            .lean();
        if (joinedUsers.length) {
            const recipientIds = joinedUsers.map((u) => u._id);
            const type = 'studio_transfer_joined';
            const title = 'New customer joined';
            const body = `${customerName} has joined your studio (from ${fromName}).`;
            const data = {
                type,
                transfer_id: transferId,
                studio_id: String(toStudioId),
                customer_name: customerName,
            };

            try {
                await notificationService.createForUsers({
                    userIds: recipientIds,
                    type,
                    title,
                    body,
                    studioTransferId: transferId,
                    studioId: toStudioId,
                });
            } catch (err) {
                console.error('Studio transfer joined notification failed:', err.message);
            }

            await sendToUsers(recipientIds, { title, body, data });
        }
    }
};

/**
 * When a customer submits a studio-change request → notify platform admins.
 */
const notifyStudioTransferRequested = async ({ transfer }) => {
    if (!transfer) return;

    const recipients = await User.find({
        role: {
            $in: [
                USER_ROLES.ADMIN,
                USER_ROLES.SUPER_ADMIN,
                USER_ROLES.DEVELOPER,
            ],
        },
    })
        .select('_id')
        .lean();
    if (!recipients.length) return;

    const recipientIds = recipients.map((u) => u._id);
    const transferId = String(transfer.id || transfer._id);
    const customerName = String(transfer.kunde_name || '').trim() || 'Customer';
    const fromName = transfer.von_firma_name || 'previous studio';
    const toName = transfer.zu_firma_name || 'new studio';
    const type = 'studio_transfer_requested';
    const title = 'Studio change request';
    const body = `${customerName} wants to switch from ${fromName} to ${toName}.`;
    const data = {
        type,
        transfer_id: transferId,
        von_firma_id: transfer.von_firma_id ? String(transfer.von_firma_id) : '',
        zu_firma_id: transfer.zu_firma_id ? String(transfer.zu_firma_id) : '',
    };

    try {
        await notificationService.createForUsers({
            userIds: recipientIds,
            type,
            title,
            body,
            studioTransferId: transferId,
            studioId: transfer.zu_firma_id || null,
        });
    } catch (err) {
        console.error('Studio transfer request notification failed:', err.message);
    }

    await sendToUsers(recipientIds, { title, body, data });
};

/**
 * In-app inbox (+ optional Expo push) for super-admin ↔ studio Support chat.
 * Expects `{ message, conversation }` from platformMessagingService.sendMessage.
 */
const notifyPlatformChatMessage = async ({ message, conversation }) => {
    if (!message || !conversation) return;

    const conversationRoom = platformMessagingService.conversationRoom(
        conversation.id
    );
    const studioId = conversation.studio?.id || message.studio_id;
    const conversationId = String(conversation.id);

    let recipients;
    let recipientRoom;
    let title;

    if (message.sender_role === PLATFORM_CHAT_SENDER_ROLE.ADMIN) {
        // Admin wrote → notify studio users.
        if (!studioId) return;
        recipientRoom = platformMessagingService.studioRoom(studioId);
        title = 'Support chat — Elaya';
        recipients = await User.find({ studio_id: studioId }).select('_id').lean();
    } else if (message.sender_role === PLATFORM_CHAT_SENDER_ROLE.STUDIO) {
        // Studio wrote → notify platform admins.
        recipientRoom = platformMessagingService.adminRoom();
        const studioName =
            conversation.studio?.firma ||
            conversation.studio?.studio_code ||
            'Studio';
        title = `Support chat — ${studioName}`;
        recipients = await User.find({
            role: {
                $in: [
                    USER_ROLES.ADMIN,
                    USER_ROLES.SUPER_ADMIN,
                    USER_ROLES.DEVELOPER,
                ],
            },
        })
            .select('_id')
            .lean();
    } else {
        return;
    }

    if (!recipients.length) return;
    if (isRecipientViewingConversation(conversationRoom, recipientRoom)) return;

    const recipientIds = recipients.map((u) => u._id);
    const data = {
        type: 'platform_chat',
        conversation_id: conversationId,
        studio_id: studioId ? String(studioId) : '',
    };

    try {
        await notificationService.createForUsers({
            userIds: recipientIds,
            type: 'platform_chat',
            title,
            body: message.text,
            conversationId: conversation.id,
            studioId: studioId || null,
            messageId: null,
        });
    } catch (err) {
        console.error('Platform chat in-app notification create failed:', err.message);
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
    notifyPlatformChatMessage,
    notifyStudioTransferDecision,
    notifyStudioTransferRequested,
};

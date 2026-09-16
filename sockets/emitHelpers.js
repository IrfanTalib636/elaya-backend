const messagingService = require('../services/messagingService');
const platformMessagingService = require('../services/platformMessagingService');
const pushService = require('../services/pushService');
const { getIO } = require('./io');

const emitMessageCreated = (payload) => {
    // Push to the receiving side's devices (skipped when they are viewing the
    // conversation live). Best effort — must never block the socket fan-out.
    pushService
        .notifyChatMessage(payload)
        .catch((err) => console.error('Chat push notification failed:', err.message));

    try {
        const io = getIO();
        if (!io) return;
        const { message, conversation } = payload;
        const envelope = { message, conversation };
        const room = messagingService.conversationRoom(conversation.id);
        io.to(room).emit('messaging:message', envelope);
        const studioId = conversation.studio?.id || message.studio_id;
        if (studioId) {
            const studioRoom = messagingService.studioRoom(studioId);
            // Studio dashboards join the studio inbox room on connect — they
            // should receive live messages even before messaging:join on a thread.
            io.to(studioRoom).emit('messaging:message', envelope);
            io.to(studioRoom).emit('messaging:conversation_updated', { conversation });
        }
        const customerId = conversation.customer?.id || message.customer_id;
        if (customerId) {
            const customerRoom = messagingService.userRoom(`customer:${customerId}`);
            io.to(customerRoom).emit('messaging:message', envelope);
            io.to(customerRoom).emit('messaging:conversation_updated', { conversation });
        }
    } catch {
        // REST / socket send still succeeds if fan-out fails
    }
};

const emitConversationRead = (conversationId, payload) => {
    try {
        const io = getIO();
        if (!io) return;
        io.to(messagingService.conversationRoom(conversationId)).emit(
            'messaging:read',
            {
                conversation_id: conversationId,
                ...payload,
            }
        );
    } catch {
        // ignore
    }
};

const emitPlatformMessageCreated = (payload) => {
    // Inbox notifications for the receiving side (skipped when they already
    // have the support thread open). Best effort — never block socket fan-out.
    pushService
        .notifyPlatformChatMessage(payload)
        .catch((err) =>
            console.error('Platform chat notification failed:', err.message)
        );

    try {
        const io = getIO();
        if (!io) return;
        const { message, conversation } = payload;
        const envelope = { message, conversation };
        const room = platformMessagingService.conversationRoom(conversation.id);
        io.to(room).emit('platform_messaging:message', envelope);

        // Fan out to inbox rooms so dashboards (and notification bells) receive
        // live messages even before platform_messaging:join on a thread.
        const studioId = conversation.studio?.id || message.studio_id;
        if (studioId) {
            const studioRoom = platformMessagingService.studioRoom(studioId);
            io.to(studioRoom).emit('platform_messaging:message', envelope);
            io.to(studioRoom).emit('platform_messaging:conversation_updated', {
                conversation,
            });
        }
        const adminRoom = platformMessagingService.adminRoom();
        io.to(adminRoom).emit('platform_messaging:message', envelope);
        io.to(adminRoom).emit('platform_messaging:conversation_updated', {
            conversation,
        });
    } catch {
        // ignore
    }
};

module.exports = {
    emitMessageCreated,
    emitConversationRead,
    emitPlatformMessageCreated,
};

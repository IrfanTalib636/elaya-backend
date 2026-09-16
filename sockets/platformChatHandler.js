const PlatformStudioConversation = require('../models/platformStudioConversationModel');
const platformMessagingService = require('../services/platformMessagingService');
const { isAdmin, isStudio, refId } = require('../utils/accessHelpers');
const { emitPlatformMessageCreated } = require('./emitHelpers');

const safeAck = (ack, payload) => {
    if (typeof ack === 'function') {
        ack(payload);
    }
};

const registerPlatformChatHandlers = (io, socket) => {
    const user = socket.user;
    if (!user) return;

    if (isAdmin(user.role)) {
        socket.join(platformMessagingService.adminRoom());
    }
    if (isStudio(user.role) && user.studio_id) {
        socket.join(platformMessagingService.studioRoom(refId(user.studio_id)));
    }

    socket.on('platform_messaging:join', async (payload = {}, ack) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            if (!conversationId) throw new Error('conversation_id is required');
            const conversation = await PlatformStudioConversation.findById(conversationId);
            if (!conversation) throw new Error('Conversation not found');
            await platformMessagingService.assertAccess(user, conversation);
            const room = platformMessagingService.conversationRoom(conversationId);
            await socket.join(room);
            safeAck(ack, { success: true, conversation_id: String(conversationId), room });
        } catch (err) {
            const message = err.message || 'Join failed';
            socket.emit('platform_messaging:error', {
                event: 'platform_messaging:join',
                message,
            });
            safeAck(ack, { success: false, message });
        }
    });

    socket.on('platform_messaging:leave', async (payload = {}, ack) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            if (!conversationId) throw new Error('conversation_id is required');
            await socket.leave(platformMessagingService.conversationRoom(conversationId));
            safeAck(ack, { success: true, conversation_id: String(conversationId) });
        } catch (err) {
            safeAck(ack, { success: false, message: err.message || 'Leave failed' });
        }
    });

    socket.on('platform_messaging:send', async (payload = {}, ack) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            if (!conversationId) throw new Error('conversation_id is required');
            const result = await platformMessagingService.sendMessage(user, conversationId, {
                text: payload.text,
            });
            emitPlatformMessageCreated(result);
            safeAck(ack, { success: true, message: result.message, conversation: result.conversation });
        } catch (err) {
            const message = err.message || 'Send failed';
            socket.emit('platform_messaging:error', {
                event: 'platform_messaging:send',
                message,
            });
            safeAck(ack, { success: false, message });
        }
    });

    socket.on('platform_messaging:typing', async (payload = {}) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            if (!conversationId) return;
            const conversation = await PlatformStudioConversation.findById(conversationId);
            if (!conversation) return;
            await platformMessagingService.assertAccess(user, conversation);
            socket
                .to(platformMessagingService.conversationRoom(conversationId))
                .emit('platform_messaging:typing', {
                    conversation_id: String(conversationId),
                    role: isAdmin(user.role) ? 'admin' : 'studio',
                    is_typing: Boolean(payload.is_typing),
                });
        } catch {
            // ignore typing failures
        }
    });
};

module.exports = { registerPlatformChatHandlers };

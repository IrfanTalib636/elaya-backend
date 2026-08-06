const messagingService = require('../services/messagingService');
const { isCustomer, isStudio, refId } = require('../utils/accessHelpers');
const ChatConversation = require('../models/chatConversationModel');
const {
    emitMessageCreated,
    emitConversationRead,
} = require('./emitHelpers');

const safeAck = (ack, payload) => {
    if (typeof ack === 'function') {
        ack(payload);
    }
};

const registerChatHandlers = (io, socket) => {
    const user = socket.user;

    // Personal / studio inbox rooms for conversation_updated fan-out
    socket.join(messagingService.userRoom(String(user._id)));
    if (isCustomer(user.role) && user.customer_id) {
        socket.join(messagingService.userRoom(`customer:${refId(user.customer_id)}`));
    }
    if (isStudio(user.role) && user.studio_id) {
        socket.join(messagingService.studioRoom(refId(user.studio_id)));
    }

    socket.emit('messaging:connected', {
        user_id: String(user._id),
        role: user.role,
    });

    socket.on('messaging:join', async (payload = {}, ack) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            if (!conversationId) {
                throw new Error('conversation_id is required');
            }
            const conversation = await ChatConversation.findById(conversationId);
            if (!conversation) {
                throw new Error('Conversation not found');
            }
            await messagingService.assertConversationAccess(user, conversation, {
                write: false,
            });
            const room = messagingService.conversationRoom(conversationId);
            await socket.join(room);
            safeAck(ack, {
                success: true,
                conversation_id: String(conversationId),
                room,
            });
        } catch (err) {
            const message = err.message || 'Join failed';
            socket.emit('messaging:error', { event: 'messaging:join', message });
            safeAck(ack, { success: false, message });
        }
    });

    socket.on('messaging:leave', async (payload = {}, ack) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            if (!conversationId) {
                throw new Error('conversation_id is required');
            }
            const room = messagingService.conversationRoom(conversationId);
            await socket.leave(room);
            safeAck(ack, { success: true, conversation_id: String(conversationId) });
        } catch (err) {
            safeAck(ack, { success: false, message: err.message || 'Leave failed' });
        }
    });

    socket.on('messaging:send', async (payload = {}, ack) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            const text = payload.text;
            const case_id = payload.case_id || payload.caseId || undefined;
            if (!conversationId) {
                throw new Error('conversation_id is required');
            }
            const result = await messagingService.sendMessage(user, conversationId, {
                text,
                case_id,
            });
            emitMessageCreated(result);
            safeAck(ack, { success: true, ...result });
        } catch (err) {
            const message = err.message || 'Send failed';
            socket.emit('messaging:error', { event: 'messaging:send', message });
            safeAck(ack, { success: false, message });
        }
    });

    socket.on('messaging:typing', async (payload = {}) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            if (!conversationId) return;
            const conversation = await ChatConversation.findById(conversationId).select(
                'customer studio'
            );
            if (!conversation) return;
            await messagingService.assertConversationAccess(user, conversation, {
                write: false,
            });
            socket
                .to(messagingService.conversationRoom(conversationId))
                .emit('messaging:typing', {
                    conversation_id: String(conversationId),
                    user_id: String(user._id),
                    role: user.role,
                    is_typing: Boolean(payload.is_typing ?? payload.isTyping ?? true),
                });
        } catch {
            // ignore typing errors
        }
    });

    socket.on('messaging:read', async (payload = {}, ack) => {
        try {
            const conversationId = payload.conversation_id || payload.conversationId;
            if (!conversationId) {
                throw new Error('conversation_id is required');
            }
            const result = await messagingService.markConversationRead(user, conversationId, {
                up_to_message_id: payload.up_to_message_id || payload.upToMessageId,
            });
            emitConversationRead(conversationId, {
                ...result,
                reader_role: user.role,
                reader_user_id: String(user._id),
            });
            safeAck(ack, { success: true, ...result });
        } catch (err) {
            const message = err.message || 'Read failed';
            socket.emit('messaging:error', { event: 'messaging:read', message });
            safeAck(ack, { success: false, message });
        }
    });
};

module.exports = {
    registerChatHandlers,
};

const messagingService = require('../services/messagingService');
const { getIO } = require('./io');

const emitMessageCreated = (payload) => {
    try {
        const io = getIO();
        if (!io) return;
        const { message, conversation } = payload;
        const room = messagingService.conversationRoom(conversation.id);
        io.to(room).emit('messaging:message', { message, conversation });
        const studioId = conversation.studio?.id || message.studio_id;
        if (studioId) {
            io.to(messagingService.studioRoom(studioId)).emit(
                'messaging:conversation_updated',
                { conversation }
            );
        }
        const customerId = conversation.customer?.id || message.customer_id;
        if (customerId) {
            io.to(messagingService.userRoom(`customer:${customerId}`)).emit(
                'messaging:conversation_updated',
                { conversation }
            );
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

module.exports = {
    emitMessageCreated,
    emitConversationRead,
};

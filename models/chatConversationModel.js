const mongoose = require('mongoose');
const { CHAT_CONVERSATION_STATUS } = require('../config/constants');

/**
 * One open thread per customer ↔ studio pair (studio live chat / Chat tab).
 * Separate from AI FAB (`POST /chat`) and from Case.chat_nachrichten system stubs.
 */
const chatConversationSchema = new mongoose.Schema(
    {
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            required: true,
            index: true,
        },
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(CHAT_CONVERSATION_STATUS),
            default: CHAT_CONVERSATION_STATUS.OPEN,
            index: true,
        },
        last_message_at: {
            type: Date,
            default: null,
            index: true,
        },
        last_message_preview: {
            type: String,
            default: '',
            trim: true,
            maxlength: 280,
        },
        last_sender_role: {
            type: String,
            default: null,
        },
        unread_customer: {
            type: Number,
            default: 0,
            min: 0,
        },
        unread_studio: {
            type: Number,
            default: 0,
            min: 0,
        },
    },
    { timestamps: true }
);

chatConversationSchema.index({ customer: 1, studio: 1 }, { unique: true });
chatConversationSchema.index({ studio: 1, last_message_at: -1 });
chatConversationSchema.index({ customer: 1, last_message_at: -1 });

const ChatConversation = mongoose.model('ChatConversation', chatConversationSchema);

module.exports = ChatConversation;

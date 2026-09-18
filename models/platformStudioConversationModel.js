const mongoose = require('mongoose');
const { CHAT_CONVERSATION_STATUS } = require('../config/constants');

/**
 * One open thread per studio ↔ Elaya platform (super admin) pair.
 * Separate from customer ↔ studio live chat (`ChatConversation`).
 */
const platformStudioConversationSchema = new mongoose.Schema(
    {
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            unique: true,
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
        unread_admin: {
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

platformStudioConversationSchema.index({ last_message_at: -1 });

module.exports = mongoose.model(
    'PlatformStudioConversation',
    platformStudioConversationSchema
);

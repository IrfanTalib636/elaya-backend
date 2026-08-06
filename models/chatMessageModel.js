const mongoose = require('mongoose');
const { CHAT_MESSAGE_TYP, CHAT_SENDER_ROLE } = require('../config/constants');

const chatMessageSchema = new mongoose.Schema(
    {
        conversation: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ChatConversation',
            required: true,
            index: true,
        },
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
        sender_user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        sender_role: {
            type: String,
            enum: Object.values(CHAT_SENDER_ROLE),
            required: true,
        },
        typ: {
            type: String,
            enum: Object.values(CHAT_MESSAGE_TYP),
            default: CHAT_MESSAGE_TYP.TEXT,
        },
        text: {
            type: String,
            required: true,
            trim: true,
            maxlength: 4000,
        },
        /** Optional case context for the message (not a separate thread). */
        case_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            default: null,
        },
        read_by_customer_at: {
            type: Date,
            default: null,
        },
        read_by_studio_at: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

chatMessageSchema.index({ conversation: 1, createdAt: -1 });
chatMessageSchema.index({ conversation: 1, _id: -1 });

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);

module.exports = ChatMessage;

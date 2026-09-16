const mongoose = require('mongoose');
const { PLATFORM_CHAT_SENDER_ROLE, CHAT_MESSAGE_TYP } = require('../config/constants');

const platformStudioMessageSchema = new mongoose.Schema(
    {
        conversation: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PlatformStudioConversation',
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
            enum: Object.values(PLATFORM_CHAT_SENDER_ROLE),
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
        read_by_admin_at: {
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

platformStudioMessageSchema.index({ conversation: 1, createdAt: -1 });
platformStudioMessageSchema.index({ conversation: 1, _id: -1 });

module.exports = mongoose.model('PlatformStudioMessage', platformStudioMessageSchema);

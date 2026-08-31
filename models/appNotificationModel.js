const mongoose = require('mongoose');

/**
 * In-app notification inbox (customer mobile). Created alongside Expo pushes
 * so the Mitteilungen screen can show history + unread state.
 */
const appNotificationSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        type: {
            type: String,
            enum: ['chat'],
            required: true,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },
        body: {
            type: String,
            required: true,
            trim: true,
            maxlength: 4000,
        },
        conversation: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ChatConversation',
            default: null,
            index: true,
        },
        case_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            default: null,
        },
        message: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ChatMessage',
            default: null,
        },
        read_at: {
            type: Date,
            default: null,
            index: true,
        },
    },
    { timestamps: true }
);

appNotificationSchema.index({ user: 1, createdAt: -1 });
appNotificationSchema.index({ user: 1, read_at: 1, createdAt: -1 });

const AppNotification = mongoose.model('AppNotification', appNotificationSchema);

module.exports = AppNotification;

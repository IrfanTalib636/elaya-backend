const mongoose = require('mongoose');
const {
    ACTIVITY_CATEGORIES,
    ACTIVITY_CATEGORY,
    ACTIVITY_ACTOR_ROLE,
} = require('../config/activityConfig');

const activityEventSchema = new mongoose.Schema(
    {
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            default: null,
            index: true,
        },
        case: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            default: null,
        },
        appointment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Appointment',
            default: null,
        },
        session: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Session',
            default: null,
        },
        category: {
            type: String,
            enum: ACTIVITY_CATEGORIES,
            default: ACTIVITY_CATEGORY.OTHER,
            index: true,
        },
        type: {
            type: String,
            required: true,
            trim: true,
        },
        tag: { type: String, default: '' },
        title: { type: String, required: true, trim: true },
        details: { type: String, default: '' },
        actor_role: {
            type: String,
            enum: Object.values(ACTIVITY_ACTOR_ROLE),
            default: ACTIVITY_ACTOR_ROLE.SYSTEM,
        },
        actor_name: { type: String, default: '' },
        actor_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        payload: { type: mongoose.Schema.Types.Mixed, default: {} },
        source_key: {
            type: String,
            required: true,
            trim: true,
        },
        ts: { type: Date, default: Date.now, index: true },
    },
    { timestamps: false }
);

activityEventSchema.index({ studio: 1, ts: -1 });
activityEventSchema.index({ studio: 1, customer: 1, ts: -1 });
activityEventSchema.index({ studio: 1, category: 1, ts: -1 });
activityEventSchema.index({ source_key: 1 }, { unique: true });

const ActivityEvent = mongoose.model('ActivityEvent', activityEventSchema);

module.exports = ActivityEvent;

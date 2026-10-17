const mongoose = require('mongoose');

/**
 * Remembers which open actions were already announced.
 * The task itself is derived from live case, aftercare and appointment state.
 * This row only prevents a new notification on every dashboard refresh.
 * It is deleted when the action is no longer open, so a later repeat notifies again.
 */
const openActionNoticeSchema = new mongoose.Schema(
    {
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        action_key: {
            type: String,
            required: true,
            trim: true,
        },
        escalated_at: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

openActionNoticeSchema.index({ studio: 1, action_key: 1 }, { unique: true });

module.exports = mongoose.model('OpenActionNotice', openActionNoticeSchema);

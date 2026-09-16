const mongoose = require('mongoose');

const STUDIO_LEAD_STATUS = {
    LEAD: 'lead',
    CONTRACT: 'contract',
    ONBOARDING: 'onboarding',
    ACTIVE: 'active',
    REJECTED: 'rejected',
};

/**
 * Platform CRM — studio partner leads before they become bookable studios.
 * Flow: lead → contract → onboarding → active (bookable).
 */
const studioLeadSchema = new mongoose.Schema(
    {
        firma: { type: String, required: true, trim: true, maxlength: 200 },
        kontakt_name: { type: String, default: '', trim: true, maxlength: 120 },
        email: { type: String, default: '', trim: true, lowercase: true, maxlength: 200 },
        telefon: { type: String, default: '', trim: true, maxlength: 60 },
        ort: { type: String, default: '', trim: true, maxlength: 120 },
        status: {
            type: String,
            enum: Object.values(STUDIO_LEAD_STATUS),
            default: STUDIO_LEAD_STATUS.LEAD,
            index: true,
        },
        notiz: { type: String, default: '', trim: true, maxlength: 2000 },
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

studioLeadSchema.index({ createdAt: -1 });
studioLeadSchema.index({ firma: 1 });

module.exports = {
    StudioLead: mongoose.model('StudioLead', studioLeadSchema),
    STUDIO_LEAD_STATUS,
};

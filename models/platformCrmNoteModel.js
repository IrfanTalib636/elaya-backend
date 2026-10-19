const mongoose = require('mongoose');
const {
    PLATFORM_CRM_SUBJECT_TYPES,
    PLATFORM_CRM_NOTE_TYP,
} = require('../config/platformCrmConfig');

const platformCrmNoteSchema = new mongoose.Schema(
    {
        subject_type: {
            type: String,
            enum: PLATFORM_CRM_SUBJECT_TYPES,
            required: true,
            index: true,
        },
        subject_id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            default: null,
            index: true,
        },
        studio_lead: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'StudioLead',
            default: null,
            index: true,
        },
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            default: null,
            index: true,
        },
        typ: {
            type: String,
            enum: Object.values(PLATFORM_CRM_NOTE_TYP),
            default: PLATFORM_CRM_NOTE_TYP.ANRUF,
        },
        inhalt: {
            type: String,
            required: true,
            trim: true,
            maxlength: 5000,
        },
        erstellt_von: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

platformCrmNoteSchema.index({ subject_type: 1, subject_id: 1, createdAt: -1 });

const PlatformCrmNote = mongoose.model('PlatformCrmNote', platformCrmNoteSchema);

module.exports = PlatformCrmNote;

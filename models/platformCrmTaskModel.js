const mongoose = require('mongoose');
const {
    PLATFORM_CRM_SUBJECT_TYPES,
    PLATFORM_CRM_TASK_TYP,
    PLATFORM_CRM_TASK_PRIORITAET,
} = require('../config/platformCrmConfig');

const platformCrmTaskSchema = new mongoose.Schema(
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
        /** Optional related studio — not required (unlike CrmTask). */
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            default: null,
            index: true,
        },
        titel: {
            type: String,
            required: true,
            trim: true,
            maxlength: 300,
        },
        typ: {
            type: String,
            enum: Object.values(PLATFORM_CRM_TASK_TYP),
            default: PLATFORM_CRM_TASK_TYP.FOLLOWUP,
        },
        prioritaet: {
            type: String,
            enum: Object.values(PLATFORM_CRM_TASK_PRIORITAET),
            default: PLATFORM_CRM_TASK_PRIORITAET.MITTEL,
        },
        faellig_am: {
            type: Date,
            required: true,
            index: true,
        },
        zugewiesen_an: {
            type: String,
            trim: true,
            default: '',
            maxlength: 120,
        },
        erledigt: {
            type: Boolean,
            default: false,
            index: true,
        },
        erledigt_am: {
            type: Date,
            default: null,
        },
        erstellt_von: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

platformCrmTaskSchema.index({
    subject_type: 1,
    subject_id: 1,
    erledigt: 1,
    faellig_am: 1,
});
platformCrmTaskSchema.index({ erledigt: 1, faellig_am: 1 });

const PlatformCrmTask = mongoose.model('PlatformCrmTask', platformCrmTaskSchema);

module.exports = PlatformCrmTask;

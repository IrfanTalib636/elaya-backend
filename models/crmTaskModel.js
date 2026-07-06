const mongoose = require('mongoose');
const { CRM_TASK_TYP, CRM_TASK_PRIORITAET } = require('../config/crmDefaults');

const crmTaskSchema = new mongoose.Schema(
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
        titel: {
            type: String,
            required: true,
            trim: true,
        },
        typ: {
            type: String,
            enum: Object.values(CRM_TASK_TYP),
            default: CRM_TASK_TYP.FOLLOWUP,
        },
        prioritaet: {
            type: String,
            enum: Object.values(CRM_TASK_PRIORITAET),
            default: CRM_TASK_PRIORITAET.MITTEL,
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

crmTaskSchema.index({ studio: 1, erledigt: 1, faellig_am: 1 });

const CrmTask = mongoose.model('CrmTask', crmTaskSchema);

module.exports = CrmTask;

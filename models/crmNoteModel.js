const mongoose = require('mongoose');
const { CRM_NOTE_TYP } = require('../config/crmDefaults');

const crmNoteSchema = new mongoose.Schema(
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
            required: true,
            index: true,
        },
        typ: {
            type: String,
            enum: Object.values(CRM_NOTE_TYP),
            default: CRM_NOTE_TYP.ANRUF,
        },
        inhalt: {
            type: String,
            required: true,
            trim: true,
        },
        erstellt_von: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

crmNoteSchema.index({ studio: 1, customer: 1, createdAt: -1 });

const CrmNote = mongoose.model('CrmNote', crmNoteSchema);

module.exports = CrmNote;

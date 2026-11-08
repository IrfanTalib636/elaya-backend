const mongoose = require('mongoose');

const CASE_DOCUMENT_TYPES = {
    MEDICAL_ANAMNESIS: 'medical_anamnesis',
    CONSENT_MERKBLATT: 'consent_merkblatt',
};

const caseDocumentSchema = new mongoose.Schema(
    {
        case: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
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
        type: {
            type: String,
            enum: Object.values(CASE_DOCUMENT_TYPES),
            required: true,
            index: true,
        },
        version: {
            type: Number,
            required: true,
            min: 1,
        },
        locale: {
            type: String,
            enum: ['de', 'en'],
            default: 'de',
        },
        title: { type: String, required: true, trim: true },
        status: {
            type: String,
            enum: ['signed'],
            default: 'signed',
        },
        signed_at: { type: Date, required: true },
        storage_path: { type: String, required: true },
        content_hash: { type: String, default: '' },
        size_bytes: { type: Number, default: 0 },
        meta: {
            case_code: { type: String, default: '' },
            case_title: { type: String, default: '' },
            studio_name: { type: String, default: '' },
            customer_name: { type: String, default: '' },
            confirmation_text: { type: String, default: '' },
        },
    },
    { timestamps: true }
);

caseDocumentSchema.index({ case: 1, type: 1, version: 1 }, { unique: true });
caseDocumentSchema.index({ customer: 1, signed_at: -1 });

module.exports = mongoose.model('CaseDocument', caseDocumentSchema);
module.exports.CASE_DOCUMENT_TYPES = CASE_DOCUMENT_TYPES;

const mongoose = require('mongoose');

const DOCUMENT_CATEGORIES = [
    'merkblatt',
    'anamnese_frage',
    'einwilligung',
    'faq',
    'sonstiges',
];

const DOCUMENT_SCOPES = ['global', 'studio_spezifisch'];

const DOCUMENT_VISIBILITY = ['customer_app', 'studio_dashboard'];

/**
 * Platform Digital Documents — Merkblatt / Anamnese / Einwilligung / FAQ templates.
 * Admin-managed CMS (prototype Digitale Dokumente). Runtime consumers can filter later.
 */
const platformDocumentSchema = new mongoose.Schema(
    {
        code: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            maxlength: 32,
            index: true,
        },
        kategorie: {
            type: String,
            enum: DOCUMENT_CATEGORIES,
            required: true,
            index: true,
        },
        titel_de: { type: String, required: true, trim: true, maxlength: 300 },
        titel_en: { type: String, default: '', trim: true, maxlength: 300 },
        inhalt_de: { type: String, default: '', trim: true, maxlength: 50000 },
        inhalt_en: { type: String, default: '', trim: true, maxlength: 50000 },
        geltungsbereich: {
            type: String,
            enum: DOCUMENT_SCOPES,
            default: 'global',
            index: true,
        },
        zugewiesene_studios: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Studio',
            },
        ],
        sichtbar_in: [
            {
                type: String,
                enum: DOCUMENT_VISIBILITY,
            },
        ],
        aktiv: { type: Boolean, default: true, index: true },
        version: { type: Number, default: 1, min: 1 },
        geaendert_von: { type: String, default: '', trim: true, maxlength: 200 },
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

platformDocumentSchema.index({ createdAt: -1 });
platformDocumentSchema.index({ kategorie: 1, geltungsbereich: 1, aktiv: 1 });

module.exports = {
    PlatformDocument: mongoose.model('PlatformDocument', platformDocumentSchema),
    DOCUMENT_CATEGORIES,
    DOCUMENT_SCOPES,
    DOCUMENT_VISIBILITY,
};

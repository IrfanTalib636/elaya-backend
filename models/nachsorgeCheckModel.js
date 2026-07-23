const mongoose = require('mongoose');

const nachsorgeCheckSchema = new mongoose.Schema(
    {
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            required: true,
            index: true,
        },
        case: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            index: true,
        },
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        foto_file_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FileAsset',
            default: null,
        },
        symptome: {
            type: [String],
            default: [],
        },
        sitzungs_datum: {
            type: Date,
            default: null,
        },
        tage_nach_sitzung: {
            type: Number,
            default: null,
        },
        /** Stage 1 — photo only */
        foto_status: {
            type: String,
            enum: ['gruen', 'orange', 'rot', null],
            default: null,
        },
        foto_befund: { type: String, default: '' },
        foto_auffaelligkeiten: { type: [String], default: [] },
        /** Stage 2 — combined final ampel */
        ampel: {
            type: String,
            enum: ['gruen', 'orange', 'rot', null],
            default: null,
        },
        titel: { type: String, default: '' },
        zusammenfassung: { type: String, default: '' },
        empfehlungen: { type: [String], default: [] },
        studio_kontakt: { type: Boolean, default: false },
        naechster_check_tage: { type: Number, default: 7 },
        hinweis: { type: String, default: '' },
        /** Full model payload for audit — never return wholesale to clients */
        raw_ai: { type: mongoose.Schema.Types.Mixed, default: null },
        erstellt_von: {
            type: String,
            enum: ['customer', 'studio'],
            default: 'customer',
        },
    },
    { timestamps: true }
);

nachsorgeCheckSchema.index({ customer: 1, createdAt: -1 });
nachsorgeCheckSchema.index({ case: 1, createdAt: -1 });
nachsorgeCheckSchema.index({ studio: 1, createdAt: -1 });

module.exports = mongoose.model('NachsorgeCheck', nachsorgeCheckSchema);

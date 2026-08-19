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
        healing_status: {
            type: String,
            enum: ['normal', 'monitor', 'conspicuous', 'delayed', null],
            default: null,
        },
        healing_phase: {
            type: String,
            enum: ['early', 'healing', 'consolidation', 'unknown', null],
            default: null,
        },
        healing_severity_score: { type: Number, default: null },
        healing_red_flag: { type: Boolean, default: false },
        healing_red_flags: { type: [String], default: [] },
        healing_needs_review: { type: Boolean, default: false },
        healing_customer_summary: { type: String, default: '' },
        healing_progress_score: { type: Number, min: 0, max: 100, default: null },
        healing_recommended_action: {
            type: String,
            enum: ['continue_aftercare', 'continue_monitoring', 'photo_again', 'check_studio', null],
            default: null,
        },
        healing_symptoms: { type: mongoose.Schema.Types.Mixed, default: null },
        healing_behavior: { type: mongoose.Schema.Types.Mixed, default: null },
        progress_direction_self: {
            type: String,
            enum: ['better', 'same', 'worse', 'unclear', null],
            default: null,
        },
        studio_review_notes: { type: String, trim: true, default: '' },
        healing_status_calculated: {
            type: String,
            enum: ['normal', 'monitor', 'conspicuous', 'delayed', null],
            default: null,
        },
        healing_studio_reviewed_at: { type: Date, default: null },
        healing_studio_reviewed_by: { type: String, trim: true, default: '' },
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

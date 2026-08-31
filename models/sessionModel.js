const mongoose = require('mongoose');
const { PAYMENT_CURRENCY, PAYMENT_METHOD } = require('../config/constants');

const zahlungSchema = new mongoose.Schema(
    {
        betrag: { type: Number, default: 0, min: 0 },
        betragCHF: { type: Number, default: 0, min: 0 },
        waehrung: {
            type: String,
            enum: Object.values(PAYMENT_CURRENCY),
            default: PAYMENT_CURRENCY.CHF,
        },
        zahlungsart: {
            type: String,
            enum: [...Object.values(PAYMENT_METHOD), null],
            default: null,
        },
        rabatt: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

const sessionSchema = new mongoose.Schema(
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
        session_number: { type: Number, required: true, min: 1 },
        session_id: { type: String, trim: true, default: '' },
        treatment_date: { type: Date, required: true, index: true },
        treatment_time: { type: String, trim: true, default: '' },
        appointment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Appointment',
            default: null,
            index: true,
        },
        standort_id: { type: String, default: '' },
        standort_name: { type: String, default: '' },
        mitarbeiter_id: { type: String, default: '' },
        mitarbeiter_name: { type: String, default: '' },
        raum_id: { type: String, default: '' },
        raum_name: { type: String, default: '' },
        dauer_minuten: { type: Number, default: null, min: 0 },
        laser_id: { type: String, default: '' },
        studio_laser_brand: { type: String, default: '' },
        studio_laser_model: { type: String, default: '' },
        laser_typ: { type: String, default: '' },
        wavelength_nm: { type: [Number], default: [] },
        fluence_j_cm2: { type: Number, default: null },
        spot_size_mm: { type: Number, default: null },
        frequency_hz: { type: Number, default: null },
        pass_count: { type: Number, default: null, min: 0 },
        cooling_used: { type: Boolean, default: false },
        endpoint_reaction: { type: String, default: '' },
        pain_score_0_10: { type: Number, min: 0, max: 10, default: null },
        adverse_event_flag: { type: Boolean, default: false },
        adverse_event_type: { type: String, default: '' },
        special_notes: { type: String, default: '' },
        removal_pct: { type: Number, min: 0, max: 100, default: null },
        verblassung_prozent: { type: Number, min: 0, max: 100, default: null },
        /** Studio-only theoretical estimate when comparison_eligible is false (IT_Clarifications §8). */
        lightening_internal_pct: { type: Number, min: 0, max: 100, default: null },
        lightening_score: { type: Number, min: 0, max: 100, default: null },
        progress_direction: {
            type: String,
            enum: ['improving', 'stable', 'worsening', 'unclear', null],
            default: null,
        },
        lightening_confidence: {
            type: String,
            enum: ['low', 'medium', 'high', null],
            default: null,
        },
        needs_human_review: { type: Boolean, default: null },
        lightening_factors: { type: mongoose.Schema.Types.Mixed, default: null },
        lightening_studio_pct: { type: Number, min: 0, max: 100, default: null },
        lightening_studio_notes: { type: String, trim: true, default: '' },
        lightening_studio_reviewed_at: { type: Date, default: null },
        comparison_eligible: { type: Boolean, default: null },
        uncertainty_level: {
            type: String,
            enum: ['low', 'medium', 'high', null],
            default: null,
        },
        comparison_reasons: { type: [String], default: [] },
        image_quality_ok: { type: Boolean, default: null },
        photo_same_angle: { type: Boolean, default: null },
        photo_same_distance: { type: Boolean, default: null },
        photo_comparable_light: { type: Boolean, default: null },
        /** Legacy string / optional file id string; prefer fortschritt_foto_file_id */
        fortschritt_foto_data: { type: String, default: '' },
        fortschritt_foto_file_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FileAsset',
            default: null,
        },
        verblassung_ki: {
            status: { type: String, default: '' },
            beurteilung: { type: String, default: '' },
            fortschritt: { type: String, default: '' },
            lifestyle_tipps: { type: String, default: '' },
            empfehlung_kunde: { type: String, default: '' },
            empfehlung_studio: { type: String, default: '' },
            farben_analyse: { type: mongoose.Schema.Types.Mixed, default: null },
            wichtiger_hinweis: { type: String, default: '' },
            analysed_at: { type: Date, default: null },
            foto_vorher_file_id: { type: String, default: '' },
            foto_aktuell_file_id: { type: String, default: '' },
            comparison_eligible: { type: Boolean, default: null },
            uncertainty_level: { type: String, default: '' },
            comparison_reasons: { type: [String], default: [] },
            needs_human_review: { type: Boolean, default: null },
            lightening_internal_pct: { type: Number, default: null },
            percent_estimate: { type: Number, default: null },
            lightening_score: { type: Number, default: null },
            progress_direction: { type: String, default: '' },
        },
        /** Audit only — never return to clients */
        verblassung_raw_ai: { type: mongoose.Schema.Types.Mixed, default: null },
        is_draft: { type: Boolean, default: false },
        is_no_show: { type: Boolean, default: false },
        /**
         * Zone this treatment belongs to, matching `CaseZone.zonen_id` ("Z001").
         * Required for zone cases, `null` for single-tattoo cases. Each zone
         * keeps its own session numbering, session log and fading series.
         */
        zonen_id: { type: String, default: null, index: true },
        zahlung: {
            type: zahlungSchema,
            default: () => ({}),
        },
    },
    {
        timestamps: true,
    }
);

// Session numbers run per zone, so two zones of the same tattoo can both have a
// session 1. For single-tattoo cases `zonen_id` is null, which keeps the
// original one-number-per-case guarantee.
sessionSchema.index({ case: 1, zonen_id: 1, session_number: 1 }, { unique: true });
sessionSchema.index({ case: 1, treatment_date: -1 });
sessionSchema.index({ studio: 1, treatment_date: -1, is_draft: 1, is_no_show: 1 });

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;

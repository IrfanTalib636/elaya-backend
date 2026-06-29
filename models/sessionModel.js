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
        fortschritt_foto_data: { type: String, default: '' },
        is_draft: { type: Boolean, default: false },
        is_no_show: { type: Boolean, default: false },
        zonen_id: { type: String, default: null },
        zahlung: {
            type: zahlungSchema,
            default: () => ({}),
        },
    },
    {
        timestamps: true,
    }
);

sessionSchema.index({ case: 1, session_number: 1 }, { unique: true });
sessionSchema.index({ case: 1, treatment_date: -1 });

const Session = mongoose.model('Session', sessionSchema);

module.exports = Session;

const mongoose = require('mongoose');
const { APPOINTMENT_STATUS, APPOINTMENT_TYPE } = require('../config/constants');

const appointmentSchema = new mongoose.Schema(
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
        day: { type: Number, min: 1, max: 31, default: null },
        month: { type: String, trim: true, default: '' },
        time: { type: String, trim: true, default: '' },
        date: { type: Date, required: true, index: true },
        status: {
            type: String,
            enum: Object.values(APPOINTMENT_STATUS),
            default: APPOINTMENT_STATUS.GEBUCHT,
            index: true,
        },
        type: {
            type: String,
            enum: Object.values(APPOINTMENT_TYPE),
            default: APPOINTMENT_TYPE.TREATMENT,
        },
        consultationOnly: { type: Boolean, default: false },
        dauer_minuten: { type: Number, default: null, min: 0 },
        standort_id: { type: String, default: '' },
        standort_name: { type: String, default: '' },
        gruppen_termin: { type: Boolean, default: false },
        gruppen_id: { type: String, default: null },
        gruppen_cases: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Case' }],
            default: [],
        },
        gruppen_rabatt: { type: Number, default: null, min: 0, max: 100 },
        gruppen_preis_total: { type: Number, default: null, min: 0 },
    },
    {
        timestamps: true,
    }
);

appointmentSchema.index({ studio: 1, date: 1, status: 1 });
appointmentSchema.index({ case: 1, date: -1 });

const Appointment = mongoose.model('Appointment', appointmentSchema);

module.exports = Appointment;

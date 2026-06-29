const mongoose = require('mongoose');
const { AKQUISE_QUELLE, PIPELINE_STUFE } = require('../config/constants');

const elaycoinTransactionSchema = new mongoose.Schema(
    {
        situationKey: { type: String, default: '' },
        label: { type: String, trim: true, default: '' },
        kat: { type: String, trim: true, default: '' },
        coins: { type: Number, required: true },
        typ: {
            type: String,
            enum: ['reward', 'malus', 'verfall'],
            default: 'reward',
        },
        datum: { type: Date, default: Date.now },
        case_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', default: null },
        session_id: { type: String, default: null },
        appointment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', default: null },
        kontext: { type: mongoose.Schema.Types.Mixed, default: null },
        herkunft_studio_id: { type: String, default: '' },
        herkunft_studio_name: { type: String, default: '' },
    },
    { _id: true }
);

const firmaHistorySchema = new mongoose.Schema(
    {
        firma_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Studio', required: true },
        von: { type: Date, required: true },
        bis: { type: Date, default: null },
        grund: { type: String, default: '' },
    },
    { _id: false }
);

const customerSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true,
        },
        vorname: {
            type: String,
            required: [true, 'vorname is required'],
            trim: true,
        },
        nachname: {
            type: String,
            required: [true, 'nachname is required'],
            trim: true,
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        telefon: {
            type: String,
            required: [true, 'telefon is required'],
            trim: true,
        },
        geburtsdatum: {
            type: Date,
            default: null,
        },
        strasse: {
            type: String,
            trim: true,
            default: '',
        },
        plz: {
            type: String,
            trim: true,
            default: '',
        },
        ort: {
            type: String,
            trim: true,
            default: '',
        },
        land: {
            type: String,
            trim: true,
            default: 'Schweiz',
        },
        akquise_quelle: {
            type: String,
            enum: Object.values(AKQUISE_QUELLE),
            required: true,
            index: true,
        },
        elaycoins: {
            balance: { type: Number, default: 0, min: 0 },
            transactions: { type: [elaycoinTransactionSchema], default: [] },
            gesendete_warnungen: { type: [String], default: [] },
        },
        aktuelle_firma_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        firma_history: {
            type: [firmaHistorySchema],
            default: [],
        },
        registriert_am: {
            type: Date,
            default: Date.now,
        },
        pipeline_stufe: {
            type: String,
            default: PIPELINE_STUFE.NEU,
            index: true,
        },
        stufe_seit: {
            type: Date,
            default: Date.now,
        },
        notizen: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

customerSchema.index({ nachname: 1, vorname: 1 });
customerSchema.index({ aktuelle_firma_id: 1, pipeline_stufe: 1 });

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;

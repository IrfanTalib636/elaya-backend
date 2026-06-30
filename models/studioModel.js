const mongoose = require('mongoose');
const { STUDIO_STATUS } = require('../config/constants');

const standortSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        strasse: { type: String, default: '', trim: true },
        plz: { type: String, default: '', trim: true },
        ort: { type: String, default: '', trim: true },
        land: { type: String, default: 'Schweiz', trim: true },
    },
    { _id: true }
);

const studioSchema = new mongoose.Schema(
    {
        firma: {
            type: String,
            required: [true, 'firma is required'],
            trim: true,
        },
        studio_code: {
            type: String,
            required: [true, 'studio code is required'],
            unique: true,
            uppercase: true,
            trim: true,
            index: true,
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        telefon: {
            type: String,
            default: '',
            trim: true,
        },
        strasse: {
            type: String,
            default: '',
            trim: true,
        },
        plz: {
            type: String,
            default: '',
            trim: true,
        },
        ort: {
            type: String,
            default: '',
            trim: true,
        },
        land: {
            type: String,
            default: 'Schweiz',
            trim: true,
        },
        status: {
            type: String,
            enum: Object.values(STUDIO_STATUS),
            default: STUDIO_STATUS.AUSSTEHEND,
            index: true,
        },
        standorte: {
            type: [standortSchema],
            default: [],
        },
        owner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        notizen: {
            type: String,
            default: '',
        },
        /** CHF value per coin — must stay within platform minWert/maxWert */
        coin_wert: {
            type: Number,
            default: null,
        },
        /** Studio pricing multiplier overrides — maps prototype `inkderm_pricing` → `studio_pricing` */
        studio_pricing: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        /** Per-situation Elaycoin overrides ({ [situationKey]: { coins?, aktiv? } }) */
        elaycoin_studio_cfg: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    {
        timestamps: true,
    }
);

const Studio = mongoose.model('Studio', studioSchema);

module.exports = Studio;

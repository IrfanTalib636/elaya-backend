const mongoose = require('mongoose');
const { STUDIO_STATUS } = require('../config/constants');
const { DEFAULT_OEFFNUNGSZEITEN } = require('../config/studioDefaults');

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

const dayHoursSchema = new mongoose.Schema(
    {
        offen: { type: Boolean, default: true },
        von: { type: String, default: '10:00', trim: true },
        bis: { type: String, default: '19:00', trim: true },
    },
    { _id: false }
);

const behandlungsraumSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        farbe: { type: String, default: '#3B8BD4', trim: true },
        aktiv: { type: Boolean, default: true },
        laser_brand: { type: String, default: '', trim: true },
        laser_model: { type: String, default: '', trim: true },
    },
    { _id: true }
);

const mitarbeiterSchema = new mongoose.Schema(
    {
        vorname: { type: String, required: true, trim: true },
        nachname: { type: String, required: true, trim: true },
        rolle: { type: String, default: 'Laser-Therapeutin', trim: true },
        raum_id: { type: String, default: '', trim: true },
        aktiv: { type: Boolean, default: true },
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
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
        /** Weekly opening hours — keys mo–so, each { offen, von, bis } */
        oeffnungszeiten: {
            type: mongoose.Schema.Types.Mixed,
            default: () => ({ ...DEFAULT_OEFFNUNGSZEITEN }),
        },
        /** Treatment rooms for calendar + sessions */
        behandlungsraeume: {
            type: [behandlungsraumSchema],
            default: [],
        },
        /** Staff roster (display / assignment — separate from login User accounts) */
        mitarbeiter: {
            type: [mitarbeiterSchema],
            default: [],
        },
        /** Buffer minutes after each appointment block */
        pufferzeit_minuten: {
            type: Number,
            default: 10,
            min: 0,
        },
    },
    {
        timestamps: true,
    }
);

const Studio = mongoose.model('Studio', studioSchema);

module.exports = Studio;

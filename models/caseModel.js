const mongoose = require('mongoose');
const {
    AKQUISE_QUELLE,
    CASE_TYPE,
    CASE_STATUS,
    TC_TYPE,
    TC_COVERUP,
    GOAL_TARGET,
} = require('../config/constants');

const sperrfristDeaktiviertSchema = new mongoose.Schema(
    {
        aktiv: { type: Boolean, default: false },
        deaktiviert_bis: { type: Date, default: null },
        begruendung: { type: String, default: '' },
    },
    { _id: false }
);

const unterschriftSchema = new mongoose.Schema(
    {
        zeitstempel: { type: Date, default: null },
        merkblatt_gelesen: { type: Boolean, default: false },
        bestaetigung_text: { type: String, default: '' },
        unterschrift_data: { type: String, default: '' },
    },
    { _id: false }
);

const activityLogSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['booked', 'cancelled', 'rescheduled'],
            required: true,
        },
        ts: { type: Date, default: Date.now },
        details: { type: String, default: '' },
    },
    { _id: true }
);

const chatNachrichtSchema = new mongoose.Schema(
    {
        von: { type: String, required: true },
        typ: { type: String, default: 'text' },
        text: { type: String, required: true },
        datum: { type: Date, default: Date.now },
        gelesen: { type: Boolean, default: false },
    },
    { _id: true }
);

const caseSchema = new mongoose.Schema(
    {
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
        caseId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        type: {
            type: String,
            enum: Object.values(CASE_TYPE),
            required: true,
            index: true,
        },
        tc_title: { type: String, trim: true, default: '' },
        bodyLabel: { type: String, trim: true, default: '' },
        tc_colors_present: { type: [String], default: [] },
        tc_size_length: { type: Number, default: null },
        tc_size_width: { type: Number, default: null },
        tc_type: {
            type: String,
            enum: [...Object.values(TC_TYPE), null],
            default: null,
        },
        tc_age_years: { type: Number, default: null },
        skin_fitzpatrick: { type: Number, min: 1, max: 6, default: null },
        tc_coverup: {
            type: String,
            enum: Object.values(TC_COVERUP),
            default: TC_COVERUP.NONE,
        },
        goal_target: {
            type: String,
            enum: [...Object.values(GOAL_TARGET), null],
            default: null,
        },
        sessions: { type: Number, default: 0, min: 0 },
        sessionsMin: { type: Number, default: 0, min: 0 },
        sessionsMax: { type: Number, default: 0, min: 0 },
        sessionsDone: { type: Number, default: 0, min: 0 },
        removal: { type: Number, default: 0, min: 0, max: 100 },
        healing: { type: Number, default: 0, min: 0, max: 100 },
        status: {
            type: String,
            enum: Object.values(CASE_STATUS),
            default: CASE_STATUS.PENDING,
            index: true,
        },
        lastSessionDate: { type: Date, default: null },
        pricePerSession: { type: Number, default: 0, min: 0 },
        akquise_quelle: {
            type: String,
            enum: Object.values(AKQUISE_QUELLE),
            required: true,
        },
        uvBlockDate: { type: Date, default: null },
        medicationBlockDate: { type: Date, default: null },
        sperrfrist_deaktiviert: {
            type: sperrfristDeaktiviertSchema,
            default: () => ({}),
        },
        zonen_aktiv: { type: Boolean, default: false },
        unterschrift: {
            type: unterschriftSchema,
            default: () => ({}),
        },
        activityLog: { type: [activityLogSchema], default: [] },
        chat_nachrichten: { type: [chatNachrichtSchema], default: [] },
    },
    {
        timestamps: true,
    }
);

caseSchema.index({ studio: 1, caseId: 1 }, { unique: true });
caseSchema.index({ customer: 1, status: 1 });

const Case = mongoose.model('Case', caseSchema);

module.exports = Case;

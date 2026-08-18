const mongoose = require('mongoose');
const {
    AKQUISE_QUELLE,
    CASE_TYPE,
    CASE_STATUS,
    STUDIO_FREIGABE_STATUS,
    ESTIMATE_CONFIRMATION_STATUS,
    MEDICAL_FLAG_LEVEL,
    TC_TYPE,
    TC_COVERUP,
    GOAL_TARGET,
} = require('../config/constants');
const {
    BODY_LOCATIONS,
    TC_SIDE,
    TC_AGE_BUCKET,
    QUALITY_LEVEL,
    SHADING_LEVEL,
    LINEWORK_LEVEL,
    RISK_LEVEL,
    SUN_EXPOSURE,
    SKIN_FITZPATRICK_TYPE,
    LIFE_SMOKER,
    LIFE_ALCOHOL,
    LIFE_ACTIVITY,
    LIFE_SLEEP_HOURS,
    LIFE_SLEEP_QUALITY,
    LIFE_STRESS,
    LIFE_HYDRATION,
    LIFE_NUTRITION,
    LIFE_AFTERCARE,
    PMU_TYPE,
    PMU_SIDE,
    PMU_AGE_RANGE,
    PMU_TECHNIQUE,
    PMU_PIGMENT_TYPE,
    PMU_STITCH_DEPTH,
    PMU_COLOR_DENSITY,
    PMU_COLOR_SATURATION,
} = require('../config/caseIntakeEnums');

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

const studioFreigabeSchema = new mongoose.Schema(
    {
        erforderlich: { type: Boolean, default: false },
        status: {
            type: String,
            enum: Object.values(STUDIO_FREIGABE_STATUS),
            default: STUDIO_FREIGABE_STATUS.NICHT_ERFORDERLICH,
        },
        ausloeser: { type: [String], default: [] },
        datum: { type: Date, default: null },
        notiz: { type: String, default: '' },
        grund: { type: String, default: '' },
        bearbeitet_von: { type: String, default: '' },
        bearbeitet_von_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { _id: false }
);

/**
 * Studio confirmation of the AI price + session-range estimate.
 * While status is offen the server keeps recomputing the estimate from the
 * studio's pricing config; once bestaetigt/angepasst the confirmed values win.
 */
const estimateConfirmationSchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: Object.values(ESTIMATE_CONFIRMATION_STATUS),
            default: ESTIMATE_CONFIRMATION_STATUS.OFFEN,
        },
        pricePerSession: { type: Number, default: null },
        sessionsMin: { type: Number, default: null },
        sessionsMax: { type: Number, default: null },
        notiz: { type: String, default: '' },
        datum: { type: Date, default: null },
        bestaetigt_von: { type: String, default: '' },
        bestaetigt_von_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { _id: false }
);

const photoStdIntakeSchema = new mongoose.Schema(
    {
        photo_full_visible: { type: Boolean, default: false },
        photo_good_light: { type: Boolean, default: false },
        photo_focus: { type: Boolean, default: false },
        photo_distance: { type: Boolean, default: false },
        photo_no_filter: { type: Boolean, default: false },
    },
    { _id: false }
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
        // TC_01 — basics
        tc_body_location_main: {
            type: String,
            enum: [...BODY_LOCATIONS, null],
            default: null,
        },
        tc_body_location_detail: { type: String, trim: true, default: '' },
        tc_side: {
            type: String,
            enum: [...TC_SIDE, null],
            default: null,
        },
        tc_age_bucket: {
            type: String,
            enum: [...TC_AGE_BUCKET, null],
            default: null,
        },
        tc_prior_treatment: { type: Boolean, default: null },
        tc_prior_treatment_count: { type: Number, min: 0, max: 99, default: null },
        // TC_02 — properties
        tc_colors_present: { type: [String], default: [] },
        tc_density: {
            type: String,
            enum: [...QUALITY_LEVEL, null],
            default: null,
        },
        tc_saturation: {
            type: String,
            enum: [...QUALITY_LEVEL, null],
            default: null,
        },
        tc_shading: {
            type: String,
            enum: [...SHADING_LEVEL, null],
            default: null,
        },
        tc_linework: {
            type: String,
            enum: [...LINEWORK_LEVEL, null],
            default: null,
        },
        tc_size_length: { type: Number, default: null },
        tc_size_width: { type: Number, default: null },
        tc_type: {
            type: String,
            enum: [...Object.values(TC_TYPE), null],
            default: null,
        },
        /** Legacy numeric age — optional; prefer tc_age_bucket from prototype wizard */
        tc_age_years: { type: Number, default: null },
        // TC_03 — skin & risk
        skin_fitzpatrick_type: {
            type: String,
            enum: [...SKIN_FITZPATRICK_TYPE, null],
            default: null,
        },
        skin_fitzpatrick: { type: Number, min: 1, max: 6, default: null },
        skin_hyperpig_risk: {
            type: String,
            enum: [...RISK_LEVEL, null],
            default: null,
        },
        skin_keloid_risk: {
            type: String,
            enum: [...RISK_LEVEL, null],
            default: null,
        },
        skin_sun_zone: {
            type: String,
            enum: [...SUN_EXPOSURE, null],
            default: null,
        },
        // TC_04 — lifestyle
        life_smoker: {
            type: String,
            enum: [...LIFE_SMOKER, null],
            default: null,
        },
        life_cig_per_day: { type: Number, min: 0, max: 60, default: null },
        life_alcohol: {
            type: String,
            enum: [...LIFE_ALCOHOL, null],
            default: null,
        },
        life_activity: {
            type: String,
            enum: [...LIFE_ACTIVITY, null],
            default: null,
        },
        life_sleep_hours: {
            type: String,
            enum: [...LIFE_SLEEP_HOURS, null],
            default: null,
        },
        life_sleep_quality: {
            type: String,
            enum: [...LIFE_SLEEP_QUALITY, null],
            default: null,
        },
        life_stress: {
            type: String,
            enum: [...LIFE_STRESS, null],
            default: null,
        },
        life_height_cm: { type: Number, min: 0, default: null },
        life_weight_kg: { type: Number, min: 0, default: null },
        life_hydration: {
            type: String,
            enum: [...LIFE_HYDRATION, null],
            default: null,
        },
        life_nutrition: {
            type: String,
            enum: [...LIFE_NUTRITION, null],
            default: null,
        },
        // TC_05 — goal
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
        goal_notes: { type: String, trim: true, default: '' },
        // PMU_01–PMU_05 — prototype permanent-makeup intake
        pmu_type: {
            type: String,
            enum: [...PMU_TYPE, null],
            default: null,
        },
        pmu_side: {
            type: String,
            enum: [...PMU_SIDE, null],
            default: null,
        },
        pmu_age_range: {
            type: String,
            enum: [...PMU_AGE_RANGE, null],
            default: null,
        },
        pmu_technique: {
            type: String,
            enum: [...PMU_TECHNIQUE, null],
            default: null,
        },
        pigment_type: {
            type: String,
            enum: [...PMU_PIGMENT_TYPE, null],
            default: null,
        },
        stitch_depth: {
            type: String,
            enum: [...PMU_STITCH_DEPTH, null],
            default: null,
        },
        previously_lasered: { type: Boolean, default: null },
        lasered_notes: { type: String, trim: true, default: '' },
        colors: { type: [String], default: [] },
        color_density: {
            type: String,
            enum: [...PMU_COLOR_DENSITY, null],
            default: null,
        },
        color_saturation: {
            type: String,
            enum: [...PMU_COLOR_SATURATION, null],
            default: null,
        },
        has_shading: { type: Boolean, default: null },
        has_linework: { type: Boolean, default: null },
        paradox_darkening_acknowledged: { type: Boolean, default: false },
        life_aftercare_commitment: {
            type: String,
            enum: [...LIFE_AFTERCARE, null],
            default: null,
        },
        // TC_06 — photos (optional until upload service; store URL or ref string)
        photo_intake_main: { type: String, default: '' },
        photo_intake_detail: { type: String, default: '' },
        photo_marker: { type: String, default: '' },
        photo_std_intake: {
            type: photoStdIntakeSchema,
            default: () => ({}),
        },
        // Merkblatt PDF ref — optional until PDF service
        merkblatt_pdf: { type: String, default: '' },
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
        /** Synced from anamnesis ampel — gruen | orange | rot | null */
        medical_flag_level: {
            type: String,
            enum: [...Object.values(MEDICAL_FLAG_LEVEL), null],
            default: null,
            index: true,
        },
        /** Count of flagged anamnesis questions (orange + red) at last save */
        open_medical_flags_count: { type: Number, default: 0, min: 0 },
        /** True after complete anamnesis PUT */
        anamnesis_complete: { type: Boolean, default: false, index: true },
        studio_freigabe: {
            type: studioFreigabeSchema,
            default: () => ({}),
        },
        estimate_confirmation: {
            type: estimateConfirmationSchema,
            default: () => ({}),
        },
        lastSessionDate: { type: Date, default: null },
        /** Effective price per session (CHF) — AI estimate until studio confirms, then confirmed value. */
        pricePerSession: { type: Number, default: 0, min: 0 },
        /** Immutable-from-studio AI snapshot; always updated by the pricing engine. */
        calculated_pricePerSession: { type: Number, default: 0, min: 0 },
        calculated_sessionsMin: { type: Number, default: 0, min: 0 },
        calculated_sessionsMax: { type: Number, default: 0, min: 0 },
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
caseSchema.index({ studio: 1, medical_flag_level: 1 });
caseSchema.index({ customer: 1, status: 1 });

const Case = mongoose.model('Case', caseSchema);

module.exports = Case;

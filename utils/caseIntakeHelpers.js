const { GOAL_TARGET } = require('../config/constants');
const {
    BODY_LOCATION_LABELS,
    FITZ_TYPE_TO_INT,
} = require('../config/caseIntakeEnums');

/** Fields customers may set during the intake wizard (steps 1–6, 8–9). */
const CUSTOMER_INTAKE_FIELDS = [
    // TC_01
    'tc_title',
    'bodyLabel',
    'tc_body_location_main',
    'tc_body_location_detail',
    'tc_side',
    'zonen_aktiv',
    'tc_age_bucket',
    'tc_age_years',
    'tc_type',
    'tc_coverup',
    'tc_prior_treatment',
    'tc_prior_treatment_count',
    // TC_02
    'tc_colors_present',
    'tc_density',
    'tc_saturation',
    'tc_shading',
    'tc_linework',
    'tc_size_length',
    'tc_size_width',
    'zonen',
    // TC_03
    'skin_fitzpatrick_type',
    'skin_fitzpatrick',
    'skin_hyperpig_risk',
    'skin_keloid_risk',
    'skin_sun_zone',
    // TC_04
    'life_smoker',
    'life_cig_per_day',
    'life_alcohol',
    'life_activity',
    'life_sleep_hours',
    'life_sleep_quality',
    'life_stress',
    'life_height_cm',
    'life_weight_kg',
    'life_hydration',
    'life_nutrition',
    // TC_05
    'goal_target',
    'goal_notes',
    // TC_06 — optional until upload API
    'photo_intake_main',
    'photo_intake_detail',
    'photo_marker',
    'photo_std_intake',
    // TC_08–09 — optional until PDF service
    'unterschrift',
    'merkblatt_pdf',
    'status',
    // KI/pricing outputs (customer may receive from pricing step)
    'sessions',
    'sessionsMin',
    'sessionsMax',
];

const normalizeGoalTarget = (value) => {
    if (value === GOAL_TARGET.FULL) {
        return GOAL_TARGET.FULL_REMOVAL;
    }
    return value;
};

const syncDerivedIntakeFields = (fields) => {
    const next = { ...fields };

    if (next.goal_target != null) {
        next.goal_target = normalizeGoalTarget(next.goal_target);
    }

    if (next.skin_fitzpatrick_type && FITZ_TYPE_TO_INT[next.skin_fitzpatrick_type]) {
        next.skin_fitzpatrick = FITZ_TYPE_TO_INT[next.skin_fitzpatrick_type];
    }

    if (next.tc_body_location_main && !next.bodyLabel?.trim()) {
        const label = BODY_LOCATION_LABELS[next.tc_body_location_main];
        if (label) {
            next.bodyLabel = label;
        }
    }

    if (next.tc_prior_treatment === false) {
        next.tc_prior_treatment_count = null;
    }

    if (!['daily_light', 'daily_heavy'].includes(next.life_smoker)) {
        next.life_cig_per_day = null;
    }

    return next;
};

module.exports = {
    CUSTOMER_INTAKE_FIELDS,
    normalizeGoalTarget,
    syncDerivedIntakeFields,
};

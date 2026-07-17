const { GOAL_TARGET, CASE_TYPE } = require('../config/constants');
const {
    BODY_LOCATION_LABELS,
    FITZ_TYPE_TO_INT,
    PMU_TYPE_LABELS,
} = require('../config/caseIntakeEnums');

/** Fields customers may set during the intake wizard (tattoo + PMU + sign-off). */
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
    'life_aftercare_commitment',
    // TC_05
    'goal_target',
    'goal_notes',
    // PMU_01–PMU_05
    'pmu_type',
    'pmu_side',
    'pmu_age_range',
    'pmu_technique',
    'pigment_type',
    'stitch_depth',
    'previously_lasered',
    'lasered_notes',
    'colors',
    'color_density',
    'color_saturation',
    'has_shading',
    'has_linework',
    'paradox_darkening_acknowledged',
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
    'pricePerSession',
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

    if (next.type === CASE_TYPE.PMU && next.pmu_type && !next.bodyLabel?.trim()) {
        const pmuLabel = PMU_TYPE_LABELS[next.pmu_type] || 'PMU';
        next.bodyLabel = next.tc_title?.trim()
            ? `${pmuLabel} — ${next.tc_title.trim()}`
            : pmuLabel;
    } else if (next.tc_body_location_main && !next.bodyLabel?.trim()) {
        const label = BODY_LOCATION_LABELS[next.tc_body_location_main];
        if (label) {
            next.bodyLabel = label;
        }
    }

    if (next.tc_prior_treatment === false) {
        next.tc_prior_treatment_count = null;
    }

    if (next.previously_lasered === false) {
        next.lasered_notes = '';
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

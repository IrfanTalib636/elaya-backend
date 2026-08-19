/**
 * Platform session-prediction parameters (Master Excel:
 * SessionForecast + SessionLogic_Master + IT_Clarifications §4–§5).
 *
 * Values in tattoo_deltas are session deltas on base_sessions (not absolute counts).
 * Lifestyle is a 7-factor composite (sleep_quality + sleep_hours → one sleep_score),
 * mapped to a 1–5 score and a session multiplier. Aftercare is not in the composite.
 * Customers must never see these internals.
 */

const DEFAULT_SESSION_PREDICTION = {
    base_sessions: 8,
    min_sessions: 3,
    max_sessions: 20,
    range_minus: 2,
    range_plus: 2,
    tattoo_deltas: {
        fitzpatrick: {
            I: 0,
            II: 0,
            III: 0,
            IV: 1,
            V: 2,
            VI: 2,
            unsicher: 1,
        },
        location: {
            face: 0,
            neck: 0,
            chest: 0,
            back: 0,
            shoulder: 0,
            abdomen: 0,
            hip: 0,
            arm: 0,
            leg: 0,
            hand: 1,
            foot: 1,
            other: 0,
        },
        /** Extra chromatic inks beyond black/grey (SessionForecast colorful 3+). */
        color_count: {
            none: 0,
            one_two: 1,
            three_plus: 3,
        },
        color: {
            black: 0,
            grey: 0,
            red: 1,
            orange: 1,
            blue: 1,
            green: 2,
            purple: 2,
            yellow: 3,
            white: 3,
            skin_tone: 3,
        },
        scarring: {
            low: 0,
            medium: 1,
            high: 2,
            unsure: 1,
        },
        laser_profile: {
            basic: 0,
            unknown: 0,
            advanced: -1,
            premium: -1,
            elite: -2,
        },
        healing_history: {
            normal: 0,
            mixed: 1,
            problematic: 3,
        },
        lightening_rate: {
            fast: -1,
            expected: 0,
            slow: 2,
            stagnant: 3,
        },
        density: {
            low: 0,
            medium: 0,
            high: 1,
            very_high: 2,
        },
        saturation: {
            low: 0,
            medium: 0,
            high: 1,
            very_high: 2,
        },
        coverup: {
            none: 0,
            once: 1,
            multiple: 2,
            unknown: 2,
        },
        age: {
            under_1: 1,
            age_1_3: 1,
            age_4_7: 0,
            age_8_15: -1,
            over_15: -1,
            unknown: 0,
        },
        prior_treatment: {
            none: 0,
            some: 1,
            many: 2,
        },
        type: {
            amateur: -1,
            cosmetic: 0,
            professional: 0,
            coverup: 1,
            mixed: 0,
        },
        goal: {
            full_removal: 0,
            full: 0,
            partial_fade: -1,
            lightening_for_coverup: -2,
        },
    },
    lifestyle_scores: {
        smoker: {
            no: 1,
            never: 1,
            occasionally: 2,
            occasional: 2,
            daily_light: 3,
            daily_heavy: 5,
        },
        alcohol: {
            never: 1,
            rarely: 1,
            moderate: 2,
            frequent: 4,
            '1-2x_week': 2,
            '3-4x_week': 3,
            '5+x_week': 5,
        },
        sleep_quality: {
            excellent: 1,
            good: 2,
            fair: 3,
            poor: 5,
        },
        sleep_hours: {
            '8+': 1,
            '7-8': 1,
            '7-9': 1,
            '6-7': 2,
            '5-6': 3,
            under_5: 5,
            '<5': 5,
        },
        stress: {
            low: 1,
            medium: 2,
            high: 3,
            very_high: 5,
        },
        activity: {
            high: 1,
            regular: 2,
            medium: 2,
            light: 3,
            low: 4,
        },
        /** Combined with activity_level into one composite factor (SessionLogic sit_activity). */
        sport_frequency: {
            '5+': 1,
            '3-4': 2,
            '1-2': 3,
            '0': 4,
        },
        hydration: {
            good: 1,
            high: 1,
            normal: 2,
            medium: 2,
            low: 4,
        },
        nutrition: {
            very_good: 1,
            balanced: 1,
            good: 2,
            fair: 3,
            poor: 4,
            very_poor: 5,
            very_bad: 5,
        },
    },
    /** Average 1.0–1.6 → 1 ×0.85; 1.7–2.4 → 2 ×0.95; 2.5–3.2 → 3 ×1.00; 3.3–4.0 → 4 ×1.20; 4.1–5.0 → 5 ×1.50 */
    lifestyle_bands: [
        { max_avg: 1.6, score: 1, multiplier: 0.85 },
        { max_avg: 2.4, score: 2, multiplier: 0.95 },
        { max_avg: 3.2, score: 3, multiplier: 1.0 },
        { max_avg: 4.0, score: 4, multiplier: 1.2 },
        { max_avg: 5.0, score: 5, multiplier: 1.5 },
    ],
    /** SessionForecast score 5 mentions obese. Floor the discrete score; BMI is not averaged. */
    lifestyle_bmi_floors: [
        { min_bmi: 35, min_score: 5 },
        { min_bmi: 30, min_score: 4 },
    ],
    /** SessionLogic sit_smoking uses smoker_status + cigarettes_per_day. */
    lifestyle_smoker_cigs: [
        { min_cigs: 20, min_score: 5 },
        { min_cigs: 15, min_score: 4 },
    ],
    aftercare_extra_max: {
        low: 2,
        medium: 0,
        high: 0,
    },
};

const deepMergeMaps = (base = {}, override = {}) => {
    const out = { ...base };
    for (const [key, value] of Object.entries(override || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            out[key] = { ...(base[key] || {}), ...value };
        } else if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
};

const mergeSessionPrediction = (stored = {}) => {
    const raw = stored && typeof stored === 'object' ? stored : {};
    return {
        ...DEFAULT_SESSION_PREDICTION,
        ...raw,
        tattoo_deltas: deepMergeMaps(
            DEFAULT_SESSION_PREDICTION.tattoo_deltas,
            raw.tattoo_deltas
        ),
        lifestyle_scores: deepMergeMaps(
            DEFAULT_SESSION_PREDICTION.lifestyle_scores,
            raw.lifestyle_scores
        ),
        lifestyle_bands:
            Array.isArray(raw.lifestyle_bands) && raw.lifestyle_bands.length
                ? raw.lifestyle_bands.map((band) => ({
                      max_avg: Number(band.max_avg),
                      score: Number(band.score),
                      multiplier: Number(band.multiplier),
                  }))
                : DEFAULT_SESSION_PREDICTION.lifestyle_bands.map((band) => ({ ...band })),
        aftercare_extra_max: {
            ...DEFAULT_SESSION_PREDICTION.aftercare_extra_max,
            ...(raw.aftercare_extra_max || {}),
        },
        lifestyle_bmi_floors:
            Array.isArray(raw.lifestyle_bmi_floors) && raw.lifestyle_bmi_floors.length
                ? raw.lifestyle_bmi_floors.map((rule) => ({
                      min_bmi: Number(rule.min_bmi),
                      min_score: Number(rule.min_score),
                  }))
                : DEFAULT_SESSION_PREDICTION.lifestyle_bmi_floors.map((rule) => ({ ...rule })),
        lifestyle_smoker_cigs:
            Array.isArray(raw.lifestyle_smoker_cigs) && raw.lifestyle_smoker_cigs.length
                ? raw.lifestyle_smoker_cigs.map((rule) => ({
                      min_cigs: Number(rule.min_cigs),
                      min_score: Number(rule.min_score),
                  }))
                : DEFAULT_SESSION_PREDICTION.lifestyle_smoker_cigs.map((rule) => ({ ...rule })),
    };
};

module.exports = {
    DEFAULT_SESSION_PREDICTION,
    mergeSessionPrediction,
};

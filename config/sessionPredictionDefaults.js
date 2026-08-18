/**
 * Platform session-prediction parameters (Master Excel:
 * Sitzungsprognose + Sitzungslogik_Master + IT_Klarstellungen).
 *
 * Values in tattoo_deltas are session deltas on base_sessions (not absolute counts).
 * Lifestyle fields are 1–5 scores, then mapped to a multiplier.
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
            multiple: 3,
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
            partial_fade: -2,
            lightening_for_coverup: -3,
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
            '6-7': 2,
            '5-6': 3,
            under_5: 5,
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
        hydration: {
            good: 1,
            high: 1,
            normal: 2,
            medium: 2,
            low: 4,
        },
        nutrition: {
            good: 2,
            fair: 3,
            poor: 4,
        },
    },
    lifestyle_bands: [
        { max_avg: 1.6, score: 1, multiplier: 0.85 },
        { max_avg: 2.4, score: 2, multiplier: 0.95 },
        { max_avg: 3.2, score: 3, multiplier: 1.0 },
        { max_avg: 4.0, score: 4, multiplier: 1.2 },
        { max_avg: 5.0, score: 5, multiplier: 1.5 },
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
    };
};

module.exports = {
    DEFAULT_SESSION_PREDICTION,
    mergeSessionPrediction,
};

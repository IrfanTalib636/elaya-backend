const DEFAULT_SESSION_PREDICTION = {
    /** Future treatments add their own session_prediction profile; tattoo is the current one. */
    treatment_key: 'tattoo',
    /** Colour impact: max = MAX(hardest colour, colour-count); sum = add both. */
    color_aggregation: 'max',
    base_sessions: 8,
    min_sessions: 3,
    max_sessions: 20,
    range_minus: 1,
    range_plus: 1,
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
        color_count: {
            none: 0,
            one_two: 1,
            three_plus: 3,
        },
        color: {
            black: 0,
            grey: 0,
            red: 0,
            orange: 2,
            blue: 0,
            green: 3,
            purple: 0,
            yellow: 2,
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
            unknown: 0,
        },
        saturation: {
            low: 0,
            medium: 0,
            high: 1,
            very_high: 2,
            unknown: 0,
        },
        /** All zeros until an admin publishes a delta. unknown is its own key, not medium. */
        shading: {
            none: 0,
            low: 0,
            medium: 0,
            high: 0,
            unknown: 0,
        },
        /** All zeros until an admin publishes a delta. unknown is its own key, not medium. */
        linework: {
            fine: 0,
            medium: 0,
            bold: 0,
            mixed: 0,
            unknown: 0,
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
        /** Ink depth. All zeros until an admin publishes a delta, so existing cases stay unchanged. */
        depth: {
            shallow: 0,
            normal: 0,
            deep: 0,
            very_deep: 0,
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
            unknown: 0,
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
            good: 2,
            fair: 3,
            poor: 4,
            // Legacy keys from the five-option simulator. Same scores as their canonical aliases.
            very_good: 2,
            balanced: 2,
            very_poor: 4,
            very_bad: 4,
        },
    },
    /**
     * How strongly each of the seven composite factors pulls the lifestyle average.
     * A weight is not extra sessions. Missing keys inherit these starting values.
     */
    lifestyle_factor_weights: {
        smoker: 3,
        alcohol: 2,
        sleep_score: 1,
        activity: 1,
        stress: 1,
        hydration: 2,
        nutrition: 1,
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

/** Colour keys of a per-laser delta map (session_prediction.laser_color_overrides[laserId]). */
const LASER_COLOR_KEYS = Object.keys(DEFAULT_SESSION_PREDICTION.tattoo_deltas.color);

const finiteColor = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const cleanLaserColorMap = (map = {}) => {
    const clean = {};
    for (const [color, value] of Object.entries(map || {})) {
        if (!LASER_COLOR_KEYS.includes(color)) continue;
        const n = finiteColor(value);
        if (n != null) clean[color] = n;
    }
    return clean;
};

/**
 * Keep only colours that differ from the platform default. Missing keys inherit,
 * so a later default change still applies to lasers without an override.
 */
const sparseLaserColorMap = (map = {}, platformColors = {}) => {
    const clean = {};
    const source = cleanLaserColorMap(map);
    for (const [color, n] of Object.entries(source)) {
        const fallback = finiteColor(platformColors?.[color]);
        if (n !== (fallback == null ? 0 : fallback)) clean[color] = n;
    }
    return clean;
};

const sparseLaserColorOverrides = (overrides = {}, platformColors = {}) => {
    const out = {};
    for (const [id, map] of Object.entries(overrides || {})) {
        const sparse = sparseLaserColorMap(map, platformColors);
        if (Object.keys(sparse).length) out[id] = sparse;
    }
    return out;
};

const sameLaserColorMap = (a = {}, b = {}) => {
    const left = cleanLaserColorMap(a);
    const right = cleanLaserColorMap(b);
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        if (left[key] !== right[key]) return false;
    }
    return true;
};

const sameLaserColorOverrides = (a = {}, b = {}) => {
    const ids = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const id of ids) {
        if (!sameLaserColorMap(a?.[id], b?.[id])) return false;
    }
    return true;
};

/**
 * Per-laser replace: a patch for `laserId` is the full override map for that laser
 * (sparse: only colours that differ from the platform default). Omitted lasers stay.
 * Sending `{}` clears every override on that laser so it inherits again.
 */
const mergeLaserColorMaps = (base = {}, override = {}) => {
    const out = {};
    for (const [id, map] of Object.entries(base || {})) {
        const clean = cleanLaserColorMap(map);
        if (Object.keys(clean).length) out[id] = clean;
    }
    for (const [id, map] of Object.entries(override || {})) {
        if (map == null) {
            delete out[id];
            continue;
        }
        const clean = cleanLaserColorMap(map);
        if (Object.keys(clean).length) out[id] = clean;
        else delete out[id];
    }
    return out;
};

const mergeSessionPrediction = (stored = {}) => {
    const raw = stored && typeof stored === 'object' ? stored : {};
    const tattoo_deltas = deepMergeMaps(
        DEFAULT_SESSION_PREDICTION.tattoo_deltas,
        raw.tattoo_deltas
    );
    return {
        ...DEFAULT_SESSION_PREDICTION,
        ...raw,
        tattoo_deltas,
        lifestyle_scores: deepMergeMaps(
            DEFAULT_SESSION_PREDICTION.lifestyle_scores,
            raw.lifestyle_scores
        ),
        lifestyle_factor_weights: {
            ...DEFAULT_SESSION_PREDICTION.lifestyle_factor_weights,
            ...(raw.lifestyle_factor_weights || {}),
        },
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
        /**
         * Sparse per-laser overrides on top of tattoo_deltas.color. Missing colours inherit
         * the platform default; only explicit diffs are stored, so default edits still apply.
         */
        laser_color_overrides: sparseLaserColorOverrides(
            mergeLaserColorMaps({}, raw.laser_color_overrides || {}),
            tattoo_deltas.color
        ),
    };
};

module.exports = {
    DEFAULT_SESSION_PREDICTION,
    LASER_COLOR_KEYS,
    mergeLaserColorMaps,
    mergeSessionPrediction,
    sparseLaserColorMap,
    sparseLaserColorOverrides,
    sameLaserColorMap,
    sameLaserColorOverrides,
};

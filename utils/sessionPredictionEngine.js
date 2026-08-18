const { FITZ_TYPE_TO_INT } = require('../config/caseIntakeEnums');
const { BODY_LOCATION_KEYS } = require('../config/pricingDefaults');
const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');

const INT_TO_FITZ = {
    1: 'I',
    2: 'II',
    3: 'III',
    4: 'IV',
    5: 'V',
    6: 'VI',
};

const lookup = (map, key, fallback = 0) => {
    if (key == null || map == null) return fallback;
    const value = map[key];
    if (value == null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const resolveFitzKey = (caseInput) => {
    if (caseInput.skin_fitzpatrick_type && FITZ_TYPE_TO_INT[caseInput.skin_fitzpatrick_type]) {
        return caseInput.skin_fitzpatrick_type;
    }
    const n = Math.min(6, Math.max(1, Number(caseInput.skin_fitzpatrick) || 0));
    return INT_TO_FITZ[n] || null;
};

const resolveBodyLocation = (caseInput) => {
    const raw =
        caseInput.tc_body_location_main ||
        caseInput.tc_body_location ||
        caseInput.koerperstelle ||
        '';
    const normalized = String(raw).toLowerCase().trim();
    if (BODY_LOCATION_KEYS.includes(normalized) || normalized === 'other') {
        return normalized;
    }
    return 'arm';
};

const hardestColorDelta = (colors, colorMap) => {
    if (!Array.isArray(colors) || colors.length === 0) return 0;
    return Math.max(0, ...colors.map((color) => lookup(colorMap, color, 0)));
};

const resolvePriorBand = (caseInput) => {
    const count = Number(caseInput.tc_prior_treatment_count);
    const treated = caseInput.tc_prior_treatment === true || (Number.isFinite(count) && count > 0);
    if (!treated) return 'none';
    if ((Number.isFinite(count) ? count : 1) >= 3) return 'many';
    return 'some';
};

const resolveGoalKey = (goal) => {
    if (!goal) return null;
    if (goal === 'full') return 'full_removal';
    return goal;
};

const collectLifestyleScores = (caseInput, scores = {}) => {
    const items = [];
    const push = (map, key) => {
        if (key == null || key === '') return;
        if (!map || map[key] == null) return;
        const n = Number(map[key]);
        if (Number.isFinite(n)) items.push(n);
    };

    push(scores.smoker, caseInput.life_smoker);
    push(scores.alcohol, caseInput.life_alcohol);
    push(scores.stress, caseInput.life_stress);
    push(scores.activity, caseInput.life_activity);
    push(scores.hydration, caseInput.life_hydration);
    push(scores.nutrition, caseInput.life_nutrition);

    const sleepHours = lookup(scores.sleep_hours, caseInput.life_sleep_hours, null);
    const sleepQuality = lookup(scores.sleep_quality, caseInput.life_sleep_quality, null);
    if (sleepHours != null && sleepQuality != null) {
        items.push((sleepHours + sleepQuality) / 2);
    } else if (sleepHours != null) {
        items.push(sleepHours);
    } else if (sleepQuality != null) {
        items.push(sleepQuality);
    }

    return items;
};

const resolveLifestyleBand = (average, bands) => {
    const sorted = [...(bands || [])].sort((a, b) => a.max_avg - b.max_avg);
    if (!sorted.length) {
        return { score: 3, multiplier: 1 };
    }
    const match = sorted.find((band) => average <= band.max_avg) || sorted[sorted.length - 1];
    return {
        score: Number(match.score) || 3,
        multiplier: Number(match.multiplier) || 1,
    };
};

const computeTattooDelta = (caseInput, deltas = {}) => {
    let delta = 0;
    delta += lookup(deltas.fitzpatrick, resolveFitzKey(caseInput), 0);
    delta += lookup(deltas.location, resolveBodyLocation(caseInput), 0);
    delta += hardestColorDelta(caseInput.tc_colors_present, deltas.color);
    delta += lookup(deltas.density, caseInput.tc_density, 0);
    delta += lookup(deltas.saturation, caseInput.tc_saturation, 0);
    delta += lookup(deltas.coverup, caseInput.tc_coverup, 0);
    delta += lookup(deltas.age, caseInput.tc_age_bucket, 0);
    delta += lookup(deltas.prior_treatment, resolvePriorBand(caseInput), 0);
    delta += lookup(deltas.type, caseInput.tc_type, 0);
    delta += lookup(deltas.goal, resolveGoalKey(caseInput.goal_target), 0);
    return delta;
};

const resolveLifestyle = (caseInput, cfg) => {
    const scores = collectLifestyleScores(caseInput, cfg.lifestyle_scores);
    if (!scores.length) {
        return { score: 3, multiplier: 1, average: null, factors: 0 };
    }
    const average = scores.reduce((sum, n) => sum + n, 0) / scores.length;
    return {
        ...resolveLifestyleBand(average, cfg.lifestyle_bands),
        average: Math.round(average * 100) / 100,
        factors: scores.length,
    };
};

const estimateSessionsFromConfig = (caseInput = {}, sessionPrediction = {}) => {
    const cfg = mergeSessionPrediction(sessionPrediction);
    const delta = computeTattooDelta(caseInput, cfg.tattoo_deltas);
    const lifestyle = resolveLifestyle(caseInput, cfg);
    const mid = (Number(cfg.base_sessions) + delta) * lifestyle.multiplier;
    const extraMax = lookup(cfg.aftercare_extra_max, caseInput.life_aftercare_commitment, 0);

    const rawMin = Math.round(mid - Number(cfg.range_minus || 0));
    const rawMax = Math.round(mid + Number(cfg.range_plus || 0) + extraMax);
    const min = clamp(Math.min(rawMin, rawMax), cfg.min_sessions, cfg.max_sessions);
    const max = clamp(Math.max(rawMin, rawMax), cfg.min_sessions, cfg.max_sessions);
    const base = clamp(Math.round(mid), cfg.min_sessions, cfg.max_sessions);

    return {
        base,
        min,
        max,
        tattoo_delta: delta,
        lifestyle_score: lifestyle.score,
        lifestyle_multiplier: lifestyle.multiplier,
        lifestyle_average: lifestyle.average,
    };
};

const estimatePmuSessionsFromConfig = (caseInput = {}, sessionPrediction = {}) => {
    const cfg = mergeSessionPrediction(sessionPrediction);
    const lifestyle = resolveLifestyle(caseInput, cfg);
    let base = 2;
    if (caseInput.pigment_type === 'inorganic') base += 1;
    if (caseInput.stitch_depth === 'deep') base += 1;
    if (caseInput.previously_lasered === true) base -= 1;
    if (caseInput.life_aftercare_commitment === 'low') base += 1;
    base = Math.round(base * (lifestyle.multiplier || 1));
    base = clamp(base, 1, 4);
    return {
        min: Math.max(1, base - 1),
        max: Math.min(4, base + 1),
        base,
        lifestyle_score: lifestyle.score,
        lifestyle_multiplier: lifestyle.multiplier,
        lifestyle_average: lifestyle.average,
    };
};

module.exports = {
    estimateSessionsFromConfig,
    estimatePmuSessionsFromConfig,
    resolveLifestyle,
    computeTattooDelta,
};

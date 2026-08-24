const { FITZ_TYPE_TO_INT } = require('../config/caseIntakeEnums');
const { BODY_LOCATION_KEYS, BLACK_FAMILY_COLORS, DIFFICULT_COLORS } = require('../config/pricingDefaults');
const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
const { computeLifestyleComposite } = require('./lifestyleCompositeEngine');

const INT_TO_FITZ = {
    1: 'I',
    2: 'II',
    3: 'III',
    4: 'IV',
    5: 'V',
    6: 'VI',
};

const REVIEW_COLORS = new Set(DIFFICULT_COLORS);
const REVIEW_LOCATIONS = new Set(['hand', 'foot', 'face']);

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

/** SessionLogic_Master age bands — not the price-multiplier buckets. */
const resolveSessionAgeBand = (caseInput) => {
    if (caseInput.tc_age_bucket) return caseInput.tc_age_bucket;
    const years = Number(caseInput.tc_age_years);
    if (!Number.isFinite(years)) return 'unknown';
    if (years < 1) return 'under_1';
    if (years <= 3) return 'age_1_3';
    if (years <= 7) return 'age_4_7';
    if (years <= 15) return 'age_8_15';
    return 'over_15';
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

const resolveColorCountBand = (colors = []) => {
    const extras = colors.filter(
        (color) => color && !BLACK_FAMILY_COLORS.includes(color)
    );
    if (extras.length === 0) return 'none';
    if (extras.length <= 2) return 'one_two';
    return 'three_plus';
};

const hardestColor = (colors = []) => {
    if (!colors.length) return null;
    const ranked = ['skin_tone', 'white', 'yellow', 'green', 'purple', 'red', 'orange', 'blue', 'grey', 'black'];
    return ranked.find((color) => colors.includes(color)) || colors[0];
};

const resolveLifestyle = (caseInput, cfg) => {
    const result = computeLifestyleComposite(caseInput, cfg);
    return {
        ...result,
        factors: result.factor_count,
        factor_scores: result.factors,
    };
};

const factor = (id, label, delta, review = false) => {
    const n = Number(delta) || 0;
    if (n === 0 && !review) return null;
    return { id, label, delta: n, review };
};

const resolveLighteningRate = (caseInput) => {
    if (caseInput.lightening_rate) return caseInput.lightening_rate;
    const pct = Number(caseInput.removal ?? caseInput.verblassung_prozent);
    const done = Number(caseInput.sessionsDone);
    if (!Number.isFinite(pct) || !Number.isFinite(done) || done < 2) return null;
    if (pct >= 40) return 'fast';
    if (pct >= 20) return 'expected';
    if (pct >= 8) return 'slow';
    return 'stagnant';
};

const collectTattooFactors = (caseInput, deltas = {}) => {
    const colors = Array.isArray(caseInput.tc_colors_present)
        ? caseInput.tc_colors_present.filter(Boolean)
        : [];
    const location = resolveBodyLocation(caseInput);
    const fitz = resolveFitzKey(caseInput);
    const ageBand = resolveSessionAgeBand(caseInput);
    const coverup = caseInput.tc_coverup || 'none';
    const prior = resolvePriorBand(caseInput);
    const colorKey = hardestColor(colors);
    const countBand = resolveColorCountBand(colors);
    const colorDelta = Math.max(
        lookup(deltas.color, colorKey, 0),
        lookup(deltas.color_count, countBand, 0)
    );

    const factors = [
        factor('sit_skin_type', 'Fitzpatrick', lookup(deltas.fitzpatrick, fitz, 0), ['V', 'VI', 'unsicher'].includes(fitz)),
        factor('sit_body_location', 'Körperstelle', lookup(deltas.location, location, 0), REVIEW_LOCATIONS.has(location)),
        factor(
            'sit_colors',
            'Farben',
            colorDelta,
            colors.some((c) => REVIEW_COLORS.has(c))
        ),
        factor('sit_density', 'Dichte', lookup(deltas.density, caseInput.tc_density, 0), caseInput.tc_density === 'very_high'),
        factor(
            'sit_saturation',
            'Sättigung',
            lookup(deltas.saturation, caseInput.tc_saturation, 0),
            ['high', 'very_high'].includes(caseInput.tc_saturation)
        ),
        factor(
            'sit_coverup',
            'Cover-up',
            lookup(deltas.coverup, coverup, 0),
            coverup === 'multiple' || coverup === 'unknown'
        ),
        factor('sit_age', 'Tattoo-Alter', lookup(deltas.age, ageBand, 0), ageBand === 'under_1'),
        factor('sit_prior_treatment', 'Vorbehandlung', lookup(deltas.prior_treatment, prior, 0), prior === 'many'),
        factor(
            'sit_scarring',
            'Narbenrisiko',
            lookup(deltas.scarring, caseInput.skin_keloid_risk, 0),
            caseInput.skin_keloid_risk === 'high'
        ),
        factor('sit_type', 'Tattoo-Art', lookup(deltas.type, caseInput.tc_type, 0), false),
        factor('sit_goal', 'Ziel', lookup(deltas.goal, resolveGoalKey(caseInput.goal_target), 0), false),
        factor(
            'sit_laser_profile',
            'Laserprofil',
            lookup(deltas.laser_profile, caseInput.laser_profile_level, 0),
            caseInput.laser_profile_level === 'basic'
        ),
        factor(
            'sit_healing_history',
            'Heilungsverlauf',
            lookup(deltas.healing_history, caseInput.healing_history, 0),
            caseInput.healing_history === 'problematic'
        ),
        factor(
            'sit_lightening_rate',
            'Hellungsrate',
            lookup(deltas.lightening_rate, resolveLighteningRate(caseInput), 0),
            ['slow', 'stagnant'].includes(resolveLighteningRate(caseInput))
        ),
    ].filter(Boolean);

    return factors;
};

const computeTattooDelta = (caseInput, deltas = {}) =>
    collectTattooFactors(caseInput, deltas).reduce((sum, item) => sum + item.delta, 0);

const estimateSessionsFromConfig = (caseInput = {}, sessionPrediction = {}) => {
    const cfg = mergeSessionPrediction(sessionPrediction);
    const factors = collectTattooFactors(caseInput, cfg.tattoo_deltas);
    const tattooDelta = factors.reduce((sum, item) => sum + item.delta, 0);
    const lifestyle = resolveLifestyle(caseInput, cfg);
    const mid = (Number(cfg.base_sessions) + tattooDelta) * lifestyle.multiplier;
    const extraMax = lookup(cfg.aftercare_extra_max, caseInput.life_aftercare_commitment, 0);

    // Simple tattoos (Excel example 1 → 6–8): ±1. Complex (examples 2–3): ±2.
    const spreadLow = tattooDelta <= 0 ? 1 : Number(cfg.range_minus || 2);
    const spreadHigh = tattooDelta <= 0 ? 1 : Number(cfg.range_plus || 2);

    const rawMin = Math.round(mid - spreadLow);
    const rawMax = Math.round(mid + spreadHigh + extraMax);
    const min = clamp(Math.min(rawMin, rawMax), cfg.min_sessions, cfg.max_sessions);
    const max = clamp(Math.max(rawMin, rawMax), cfg.min_sessions, cfg.max_sessions);
    const base = clamp(Math.round(mid), cfg.min_sessions, cfg.max_sessions);

    const factorRows = factors.map((item) => ({
        id: item.id,
        label: item.label,
        delta: item.delta,
        review: Boolean(item.review),
    }));
    const topFactors = [...factorRows]
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 4)
        .map(({ id, label, delta }) => ({ id, label, delta }));

    const reviewTriggers = factors.filter((item) => item.review).map((item) => item.id);
    const missingTriggers = [
        !caseInput.tc_colors_present?.length && 'missing_colors',
        !(caseInput.skin_fitzpatrick_type || caseInput.skin_fitzpatrick) && 'missing_fitzpatrick',
        !(caseInput.tc_body_location_main || caseInput.tc_body_location) && 'missing_location',
        !caseInput.tc_age_bucket && caseInput.tc_age_years == null && 'missing_age',
    ].filter(Boolean);
    const uncertainty_score = Math.min(
        100,
        reviewTriggers.length * 15 + missingTriggers.length * 20
    );
    const allTriggers = [...new Set([...reviewTriggers, ...missingTriggers])];

    return {
        base,
        min,
        max,
        tattoo_delta: tattooDelta,
        lifestyle_score: lifestyle.score,
        lifestyle_multiplier: lifestyle.multiplier,
        lifestyle_average: lifestyle.average,
        lifestyle_factors: lifestyle.factor_scores,
        lifestyle_bmi: lifestyle.bmi,
        top_factors: topFactors,
        factors: factorRows,
        formula: {
            base_sessions: Number(cfg.base_sessions),
            tattoo_delta: tattooDelta,
            sum_before_lifestyle: Number(cfg.base_sessions) + tattooDelta,
            lifestyle_multiplier: lifestyle.multiplier,
            mid: Math.round(mid * 100) / 100,
            spread_low: spreadLow,
            spread_high: spreadHigh,
            aftercare_extra_max: extraMax,
            raw_min: rawMin,
            raw_max: rawMax,
            min_sessions: Number(cfg.min_sessions),
            max_sessions: Number(cfg.max_sessions),
        },
        needs_human_review: allTriggers.length > 0,
        review_triggers: allTriggers,
        uncertainty_score,
        confidence_score: Math.max(40, 100 - uncertainty_score),
    };
};

/**
 * Live calculator preview — same engine as case create, with optional baseline compare.
 * Does not persist anything. Used by admin/studio settings.
 */
const previewSessionPrediction = (caseInput = {}, draftPrediction = {}, options = {}) => {
    const live = estimateSessionsFromConfig(caseInput, draftPrediction);
    const baselineConfig = options.baselinePrediction;
    const baseline =
        baselineConfig != null
            ? estimateSessionsFromConfig(caseInput, baselineConfig)
            : null;

    return {
        case_input: caseInput,
        live,
        baseline,
        delta: baseline
            ? {
                  sessions_min: live.min - baseline.min,
                  sessions_max: live.max - baseline.max,
                  base: live.base - baseline.base,
                  tattoo_delta: live.tattoo_delta - baseline.tattoo_delta,
                  lifestyle_multiplier:
                      Math.round(
                          (live.lifestyle_multiplier - baseline.lifestyle_multiplier) * 1000
                      ) / 1000,
              }
            : null,
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
        lifestyle_factors: lifestyle.factor_scores,
        lifestyle_bmi: lifestyle.bmi,
        top_factors: [],
        needs_human_review: false,
        review_triggers: [],
        uncertainty_score: 0,
        confidence_score: 100,
    };
};

module.exports = {
    estimateSessionsFromConfig,
    estimatePmuSessionsFromConfig,
    previewSessionPrediction,
    resolveLifestyle,
    computeTattooDelta,
};

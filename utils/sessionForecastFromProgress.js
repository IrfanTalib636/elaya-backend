/**
 * Progress-based session-range forecast.
 *
 * Compares actual AI fade to an expected cumulative fade after N sessions
 * (not a linear invert of %), classifies pace, then adjusts the frozen
 * original prediction via configured lightening_rate deltas.
 */

const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
const {
    expectedVisibilityFactor,
} = require('./lighteningLogicEngine');

const COLOR_RESISTANCE = {
    black: 1,
    grey: 1,
    blue: 2,
    red: 2,
    orange: 2,
    brown: 2,
    green: 3,
    purple: 3,
    yellow: 4,
    white: 4,
    skin_tone: 4,
};

const LEVEL_1_TO_4 = {
    low: 1,
    medium: 2,
    high: 3,
    very_high: 4,
};

const COVERUP_SCORE = {
    none: 0,
    false: 0,
    once: 1,
    multiple: 2,
    true: 2,
    unknown: 2,
};

const LASER_MODULATOR = {
    basic: -1,
    unknown: 0,
    standard: 0,
    advanced: 0.5,
    premium: 0.75,
    elite: 1,
};

const SMOKING_MODULATOR = {
    no: 0,
    never: 0,
    occasionally: 1,
    daily_light: 1,
    daily_heavy: 2,
};

const SLEEP_LOAD = {
    excellent: 0,
    good: 1,
    fair: 2,
    poor: 3,
};

const STRESS_LOAD = {
    low: 0,
    medium: 1,
    high: 2,
    very_high: 3,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const roundPct = (value) => {
    if (value == null || !Number.isFinite(Number(value))) return null;
    return clamp(Math.round(Number(value)), 0, 100);
};

const hardestColorScore = (colors = []) => {
    const list = (Array.isArray(colors) ? colors : []).map((c) => String(c || '').toLowerCase());
    if (!list.length) return 2;
    let score = 1;
    for (const item of list) {
        score = Math.max(score, COLOR_RESISTANCE[item] ?? 2);
    }
    return score;
};

const sleepStressModulator = (sleepQuality, stressLevel) => {
    const sleep = SLEEP_LOAD[String(sleepQuality || '').toLowerCase()];
    const stress = STRESS_LOAD[String(stressLevel || '').toLowerCase()];
    const load = (sleep ?? 1) + (stress ?? 1);
    if (load <= 1) return -1;
    if (load <= 3) return 0;
    if (load <= 4) return 1;
    return 2;
};

/** Visibility factor from case intake fields (same family as lightening logic). */
const visibilityFactorFromCase = (caseDoc = {}) => {
    const colors = caseDoc.tc_colors_present || [];
    const density = LEVEL_1_TO_4[String(caseDoc.tc_density || '').toLowerCase()] || 2;
    const saturation = LEVEL_1_TO_4[String(caseDoc.tc_saturation || '').toLowerCase()] || 2;
    const coverup = COVERUP_SCORE[String(caseDoc.tc_coverup || 'none').toLowerCase()] ?? 0;
    const smoking = SMOKING_MODULATOR[String(caseDoc.life_smoking || caseDoc.smoker || '').toLowerCase()] ?? 0;
    const laser = LASER_MODULATOR[String(caseDoc.laser_profile_level || 'standard').toLowerCase()] ?? 0;
    const sleep_stress = sleepStressModulator(caseDoc.life_sleep_quality, caseDoc.life_stress);
    return expectedVisibilityFactor({
        color_resistance: hardestColorScore(colors),
        density,
        saturation,
        coverup,
        smoking,
        sleep_stress,
        laser,
    });
};

/**
 * Expected cumulative fade after N completed laser sessions.
 * ~10% per session × visibility factor (heuristic used elsewhere in lightening).
 */
const expectedFadeAfterSessions = (sessionsDone, visibilityFactor = 1) => {
    const n = Math.max(0, Number(sessionsDone) || 0);
    const factor = Number.isFinite(Number(visibilityFactor)) ? Number(visibilityFactor) : 1;
    return roundPct(n * 10 * factor);
};

/**
 * Classify pace from actual vs expected fade (ratio bands, not linear invert).
 */
const classifyFadePace = (actualFadePct, expectedFadePct) => {
    const actual = Number(actualFadePct);
    const expected = Number(expectedFadePct);
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || expected <= 0) {
        if (Number.isFinite(actual)) {
            if (actual >= 40) return 'fast';
            if (actual >= 20) return 'expected';
            if (actual >= 8) return 'slow';
            return 'stagnant';
        }
        return 'expected';
    }
    const ratio = actual / expected;
    if (ratio >= 1.25) return 'fast';
    if (ratio >= 0.75) return 'expected';
    if (ratio >= 0.35) return 'slow';
    return 'stagnant';
};

const resolveOriginalRange = (caseDoc = {}) => {
    if (
        caseDoc.original_sessionsMin != null &&
        caseDoc.original_sessionsMax != null &&
        Number(caseDoc.original_sessionsMin) > 0
    ) {
        return {
            min: Number(caseDoc.original_sessionsMin),
            max: Number(caseDoc.original_sessionsMax),
            frozen: true,
        };
    }

    const conf = caseDoc.estimate_confirmation || {};
    if (
        ['bestaetigt', 'angepasst'].includes(conf.status) &&
        Number(conf.sessionsMin) > 0 &&
        Number(conf.sessionsMax) > 0
    ) {
        return { min: Number(conf.sessionsMin), max: Number(conf.sessionsMax), frozen: false };
    }

    const min =
        Number(caseDoc.sessionsMin) > 0
            ? Number(caseDoc.sessionsMin)
            : Number(caseDoc.calculated_sessionsMin) || 0;
    const max =
        Number(caseDoc.sessionsMax) > 0
            ? Number(caseDoc.sessionsMax)
            : Number(caseDoc.calculated_sessionsMax) || min;
    return { min, max, frozen: false };
};

const adjustRangeForPace = (originalMin, originalMax, pace, sessionPrediction = {}) => {
    const cfg = mergeSessionPrediction(sessionPrediction);
    const deltas = cfg.tattoo_deltas?.lightening_rate || {};
    const delta = Number(deltas[pace] ?? 0) || 0;
    const minS = Number(cfg.min_sessions) || 3;
    const maxS = Number(cfg.max_sessions) || 20;

    const origMin = Math.max(1, Number(originalMin) || minS);
    const origMax = Math.max(origMin, Number(originalMax) || origMin);
    const center = Math.round((origMin + origMax) / 2);
    const spreadLow = center - origMin;
    const spreadHigh = origMax - center;

    let newCenter = clamp(center + delta, minS, maxS);
    let min = Math.max(minS, newCenter - spreadLow);
    let max = Math.min(maxS, newCenter + spreadHigh);
    if (max < min) max = min;

    return { min, max, center: newCenter, delta, pace };
};

/**
 * Pure computation — does not mutate the case.
 * Returns null when recalculation is not suitable.
 */
const computeSessionForecast = ({
    caseDoc,
    sessionsDone,
    actualFadePct,
    comparisonEligible = true,
    customerProgressVisible = true,
    sourceSessionId = null,
    sessionPrediction = {},
} = {}) => {
    const done = Math.max(0, Number(sessionsDone) || 0);
    if (done < 2) return null;
    if (comparisonEligible === false || customerProgressVisible === false) return null;

    const actual = roundPct(actualFadePct);
    if (actual == null) return null;

    const visibility = visibilityFactorFromCase(caseDoc);
    const expected = expectedFadeAfterSessions(done, visibility);
    const pace = classifyFadePace(actual, expected);
    const original = resolveOriginalRange(caseDoc);
    if (!(original.min > 0) || !(original.max > 0)) return null;

    const adjusted = adjustRangeForPace(original.min, original.max, pace, sessionPrediction);
    let currentMin = Math.max(done, adjusted.min);
    let currentMax = Math.max(done, adjusted.max);
    if (currentMax < currentMin) currentMax = currentMin;

    const remainingMin = Math.max(0, currentMin - done);
    const remainingMax = Math.max(0, currentMax - done);

    return {
        should_freeze_original: !original.frozen,
        original_sessionsMin: original.min,
        original_sessionsMax: original.max,
        current_sessionsMin: currentMin,
        current_sessionsMax: currentMax,
        remaining_sessionsMin: remainingMin,
        remaining_sessionsMax: remainingMax,
        sessions_forecast_meta: {
            pace,
            expected_fade_pct: expected,
            actual_fade_pct: actual,
            visibility_factor: Math.round(visibility * 100) / 100,
            sessions_done: done,
            lightening_delta: adjusted.delta,
            source_session_id: sourceSessionId ? String(sourceSessionId) : null,
        },
    };
};

/**
 * Apply forecast onto a Mongoose case document (or plain object). Saves if doc.save exists.
 */
const applySessionForecastToCase = async (caseDoc, options = {}) => {
    const forecast = computeSessionForecast({
        caseDoc,
        sessionsDone: options.sessionsDone ?? caseDoc.sessionsDone,
        actualFadePct: options.actualFadePct ?? caseDoc.removal,
        comparisonEligible: options.comparisonEligible,
        customerProgressVisible: options.customerProgressVisible,
        sourceSessionId: options.sourceSessionId,
        sessionPrediction: options.sessionPrediction,
    });
    if (!forecast) return null;

    if (forecast.should_freeze_original) {
        caseDoc.original_sessionsMin = forecast.original_sessionsMin;
        caseDoc.original_sessionsMax = forecast.original_sessionsMax;
    }
    caseDoc.current_sessionsMin = forecast.current_sessionsMin;
    caseDoc.current_sessionsMax = forecast.current_sessionsMax;
    caseDoc.sessions_forecast_updated_at = new Date();
    caseDoc.sessions_forecast_meta = forecast.sessions_forecast_meta;

    if (typeof caseDoc.save === 'function') {
        await caseDoc.save();
    }
    return forecast;
};

const formatSessionForecastFields = (doc = {}) => {
    const originalMin =
        doc.original_sessionsMin > 0
            ? doc.original_sessionsMin
            : null;
    const originalMax =
        doc.original_sessionsMax > 0
            ? doc.original_sessionsMax
            : null;
    const currentMin =
        doc.current_sessionsMin > 0
            ? doc.current_sessionsMin
            : originalMin || (doc.sessionsMin > 0 ? doc.sessionsMin : null);
    const currentMax =
        doc.current_sessionsMax > 0
            ? doc.current_sessionsMax
            : originalMax || (doc.sessionsMax > 0 ? doc.sessionsMax : null);
    const done = Math.max(0, Number(doc.sessionsDone) || 0);
    const remainingMin =
        currentMin != null ? Math.max(0, currentMin - done) : null;
    const remainingMax =
        currentMax != null ? Math.max(0, currentMax - done) : null;

    return {
        original_sessionsMin: originalMin,
        original_sessionsMax: originalMax,
        current_sessionsMin: currentMin,
        current_sessionsMax: currentMax,
        remaining_sessionsMin: remainingMin,
        remaining_sessionsMax: remainingMax,
        sessions_forecast_updated_at: doc.sessions_forecast_updated_at || null,
        sessions_forecast_meta: doc.sessions_forecast_meta || null,
    };
};

/** Baseline intake photo file id for timeline compare. */
const resolveBaselinePhotoFileId = (caseDoc = {}, zones = []) => {
    // photo_std_intake holds quality flags only — the intake FileAsset id is photo_intake_main.
    const main = caseDoc.photo_intake_main;
    if (main && typeof main === 'string' && main.length >= 12 && !main.startsWith('data:')) {
        return String(main);
    }
    const zoneList = Array.isArray(zones) ? zones : [];
    for (const z of zoneList) {
        const foto = z.foto_url || z.foto_file_id;
        if (foto && typeof foto === 'string' && foto.length >= 12 && !String(foto).startsWith('http') && !String(foto).startsWith('data:')) {
            return String(foto);
        }
    }
    return null;
};

module.exports = {
    visibilityFactorFromCase,
    expectedFadeAfterSessions,
    classifyFadePace,
    resolveOriginalRange,
    adjustRangeForPace,
    computeSessionForecast,
    applySessionForecastToCase,
    formatSessionForecastFields,
    resolveBaselinePhotoFileId,
};

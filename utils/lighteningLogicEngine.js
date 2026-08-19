/**
 * Lightening logic — Master Excel IT_Clarifications §8 + LighteningLogic_Master
 * and Photo_Standards.
 *
 * comparison_eligible (from lighteningComparisonEngine) is the gatekeeper.
 * Customer-facing percent_estimate exists only for a real comparable image pair.
 * Studio may still see a theoretical internal estimate, uncertainty, and raw factors.
 *
 * Outputs: percent_estimate, lightening_score, uncertainty_level,
 * comparison_eligible, needs_human_review, progress_direction, confidence.
 */

const { computeComparisonEligible, resolveDayWindow } = require('./lighteningComparisonEngine');
const { DIFFICULT_COLORS } = require('../config/pricingDefaults');

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

const hardestColorResistance = (colors = []) => {
    const list = (Array.isArray(colors) ? colors : []).map((c) => String(c || '').toLowerCase());
    if (!list.length) return { color: null, score: null, missing: true };
    let score = 1;
    let color = list[0];
    for (const item of list) {
        const n = COLOR_RESISTANCE[item] ?? 2;
        if (n >= score) {
            score = n;
            color = item;
        }
    }
    return { color, score, missing: false };
};

const levelScore = (value, missingDefault = null) => {
    if (value == null || value === '') return { score: missingDefault, missing: true };
    const n = LEVEL_1_TO_4[String(value).toLowerCase()];
    if (!n) return { score: missingDefault, missing: true };
    return { score: n, missing: false };
};

const sleepStressModulator = (sleepQuality, stressLevel) => {
    const sleep = SLEEP_LOAD[String(sleepQuality || '').toLowerCase()];
    const stress = STRESS_LOAD[String(stressLevel || '').toLowerCase()];
    const missing = sleep == null || stress == null;
    const load = (sleep ?? 1) + (stress ?? 1);
    let modulator = 0;
    if (load <= 1) modulator = -1;
    else if (load <= 3) modulator = 0;
    else if (load <= 4) modulator = 1;
    else modulator = 2;
    return {
        modulator,
        missing,
        review: String(sleepQuality).toLowerCase() === 'poor' && String(stressLevel).toLowerCase() === 'very_high',
    };
};

const expectedVisibilityFactor = (factors) => {
    const drag =
        Math.max(0, (factors.color_resistance || 1) - 1) * 0.04 +
        Math.max(0, (factors.density || 2) - 1) * 0.03 +
        Math.max(0, (factors.saturation || 2) - 1) * 0.03 +
        (factors.coverup || 0) * 0.05 +
        (factors.smoking || 0) * 0.03 +
        Math.max(0, factors.sleep_stress || 0) * 0.04;
    const boost = (factors.laser || 0) * 0.06;
    return clamp(1 - drag + boost, 0.65, 1.12);
};

const resolveProgressDirection = ({
    comparison_eligible,
    too_early,
    percent,
    previous_percent,
    progress_direction_self,
}) => {
    if (!comparison_eligible || too_early || percent == null) return 'unclear';
    if (previous_percent != null && Number.isFinite(Number(previous_percent))) {
        const delta = percent - Number(previous_percent);
        if (delta >= 6) return 'improving';
        if (delta <= -6) return 'worsening';
        return 'stable';
    }
    if (percent >= 8) return 'improving';
    if (progress_direction_self === 'better') return 'improving';
    if (progress_direction_self === 'worse') return 'worsening';
    if (progress_direction_self === 'same') return 'stable';
    return percent > 0 ? 'improving' : 'unclear';
};

const confidenceFromUncertainty = (level) => {
    if (level === 'high') return 'low';
    if (level === 'medium') return 'medium';
    return 'high';
};

/**
 * @param {object} input
 * @param {object} [input.comparison] result from computeComparisonEligible
 * @param {number|null} [input.visual_fade_pct] normalized visual fade 0–100 (AI or studio)
 * @param {number|null} [input.previous_percent] last customer-visible percent
 * @param {number|null} [input.studio_review_pct] human-in-the-loop correction
 * @param {string[]} [input.colors]
 * @param {string} [input.density]
 * @param {string} [input.saturation]
 * @param {string} [input.coverup]
 * @param {string} [input.laser_profile_level]
 * @param {string} [input.smoker]
 * @param {string} [input.sleep_quality]
 * @param {string} [input.stress_level]
 * @param {number|null} [input.days_since_previous]
 * @param {number} [input.sessions_done]
 * @param {string} [input.progress_direction_self] better|same|worse|unclear
 */
const computeLighteningAssessment = (input = {}) => {
    const comparison =
        input.comparison ||
        computeComparisonEligible({
            has_initial_photo: input.has_initial_photo,
            has_follow_up_photo: input.has_follow_up_photo,
            same_region: input.same_region,
            photo_std_intake: input.photo_std_intake,
            image_quality_ok: input.image_quality_ok,
            photo_same_angle: input.photo_same_angle,
            photo_same_distance: input.photo_same_distance,
            photo_comparable_light: input.photo_comparable_light,
            days_since_previous: input.days_since_previous,
            coverup_level: input.coverup,
        });

    const dayWindow = comparison.day_window || resolveDayWindow(input.days_since_previous);
    const color = hardestColorResistance(input.colors);
    const density = levelScore(input.density);
    const saturation = levelScore(input.saturation);
    const coverupKey = String(input.coverup || 'none').toLowerCase();
    const coverup = COVERUP_SCORE[coverupKey] ?? 0;
    const laserKey = String(input.laser_profile_level || 'unknown').toLowerCase();
    const laser = LASER_MODULATOR[laserKey] ?? 0;
    const smoking = SMOKING_MODULATOR[String(input.smoker || '').toLowerCase()] ?? 0;
    const sleepStress = sleepStressModulator(input.sleep_quality, input.stress_level);

    const factors = {
        color_resistance: color.score,
        hardest_color: color.color,
        density: density.score,
        saturation: saturation.score,
        coverup,
        laser,
        smoking,
        sleep_stress: sleepStress.modulator,
        visibility_factor: null,
    };

    const reviewTriggers = [...(comparison.reasons || [])];
    if (color.score >= 4 || DIFFICULT_COLORS.includes(color.color)) reviewTriggers.push('difficult_color');
    if (density.score === 4) reviewTriggers.push('very_high_density');
    if (saturation.score === 4) reviewTriggers.push('very_high_saturation');
    if (coverup >= 2) reviewTriggers.push('coverup_layering');
    if (laserKey === 'basic') reviewTriggers.push('basic_laser');
    if (smoking >= 2) reviewTriggers.push('daily_heavy_smoking');
    if (sleepStress.review) reviewTriggers.push('poor_sleep_high_stress');
    if (dayWindow.too_early) reviewTriggers.push('too_early');
    if (!comparison.comparison_eligible) reviewTriggers.push('not_comparison_eligible');

    const missingCore = [
        color.missing,
        density.missing,
        saturation.missing,
        !input.smoker,
        sleepStress.missing,
        dayWindow.band === 'unknown',
    ].filter(Boolean).length;

    let uncertainty_level = comparison.uncertainty_level || 'medium';
    if (missingCore >= 1 && uncertainty_level === 'low') uncertainty_level = 'medium';
    if (missingCore >= 5) uncertainty_level = 'high';
    if (!comparison.comparison_eligible) uncertainty_level = 'high';

    const visibilityFactor = expectedVisibilityFactor({
        color_resistance: color.score || 2,
        density: density.score || 2,
        saturation: saturation.score || 2,
        coverup,
        smoking,
        sleep_stress: sleepStress.modulator,
        laser,
    });
    factors.visibility_factor = Math.round(visibilityFactor * 100) / 100;

    const visual = roundPct(input.visual_fade_pct);
    const studioReview = roundPct(input.studio_review_pct);
    const sessionsDone = Math.max(0, Number(input.sessions_done) || 0);

    // Image-pair fade is the measurement. Modulators only build a heuristic
    // when there is no visual score — they must not rewrite a real comparison.
    let heuristic = null;
    if (sessionsDone >= 1) {
        heuristic = roundPct(sessionsDone * 10 * visibilityFactor);
    }

    const measured = studioReview ?? visual;
    const lightening_internal_pct = measured ?? heuristic;
    const lightening_score = lightening_internal_pct;

    const customer_progress_visible = Boolean(comparison.comparison_eligible && !dayWindow.too_early);
    const percent_estimate = customer_progress_visible ? measured : null;

    const progress_direction = resolveProgressDirection({
        comparison_eligible: customer_progress_visible,
        too_early: dayWindow.too_early,
        percent: percent_estimate,
        previous_percent: roundPct(input.previous_percent),
        progress_direction_self: input.progress_direction_self,
    });

    if (customer_progress_visible && progress_direction === 'unclear') {
        reviewTriggers.push('unclear_direction');
    }
    if (
        customer_progress_visible &&
        input.progress_direction_self &&
        ((input.progress_direction_self === 'worse' && progress_direction === 'improving') ||
            (input.progress_direction_self === 'better' && progress_direction === 'worsening'))
    ) {
        reviewTriggers.push('self_report_mismatch');
        if (uncertainty_level === 'low') uncertainty_level = 'medium';
    }

    const uniqueTriggers = [...new Set(reviewTriggers)];
    const needs_human_review =
        Boolean(comparison.needs_human_review) ||
        uniqueTriggers.length > 0 ||
        missingCore > 0 ||
        lightening_internal_pct == null;

    return {
        comparison_eligible: comparison.comparison_eligible,
        customer_progress_visible,
        uncertainty_level,
        needs_human_review,
        percent_estimate,
        lightening_score,
        lightening_internal_pct,
        progress_direction,
        confidence: confidenceFromUncertainty(uncertainty_level),
        review_triggers: uniqueTriggers,
        factors,
        day_window: dayWindow,
        comparison_reasons: comparison.reasons || [],
        checks: comparison.checks,
        customer_message: comparison.customer_message,
        theoretical: measured == null,
        studio_reviewed: studioReview != null,
        missing_field_count: missingCore,
    };
};

const applyLighteningToSession = (sessionDoc, assessment) => {
    if (!sessionDoc || !assessment) return sessionDoc;

    sessionDoc.comparison_eligible = assessment.comparison_eligible;
    sessionDoc.uncertainty_level = assessment.uncertainty_level;
    sessionDoc.comparison_reasons = assessment.comparison_reasons || [];
    sessionDoc.lightening_internal_pct = assessment.lightening_internal_pct;
    sessionDoc.lightening_score = assessment.lightening_score;
    sessionDoc.progress_direction = assessment.progress_direction;
    sessionDoc.lightening_confidence = assessment.confidence;
    sessionDoc.needs_human_review = assessment.needs_human_review;
    sessionDoc.lightening_factors = assessment.factors || null;

    if (assessment.customer_progress_visible && assessment.percent_estimate != null) {
        sessionDoc.verblassung_prozent = assessment.percent_estimate;
        sessionDoc.removal_pct = assessment.percent_estimate;
    } else {
        sessionDoc.verblassung_prozent = null;
        sessionDoc.removal_pct = null;
    }

    return sessionDoc;
};

module.exports = {
    computeLighteningAssessment,
    applyLighteningToSession,
    hardestColorResistance,
    expectedVisibilityFactor,
    COLOR_RESISTANCE,
};

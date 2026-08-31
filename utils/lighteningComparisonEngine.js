/**
 * Lightening comparison gate — Master Excel IT_Clarifications §6 R3 + §8
 * and LighteningLogic_Master / Photo_Standards.
 *
 * comparison_eligible is true only when a real image pair can be compared:
 * initial photo + follow-up photo + same tattoo region + sufficient quality
 * + comparable angle / section / light. Too-early checks (<14 days) are not eligible.
 *
 * If not eligible, no customer-facing hard lightening % may be shown.
 * Studio may still see a theoretical internal estimate.
 */

const QUALITY_KEYS = [
    'photo_full_visible',
    'photo_good_light',
    'photo_focus',
    'photo_distance',
    'photo_no_filter',
];

const resolveDayWindow = (days) => {
    if (days == null || !Number.isFinite(Number(days))) {
        return { band: 'unknown', days: null, too_early: false };
    }
    const n = Math.max(0, Math.floor(Number(days)));
    if (n < 14) return { band: 'under_14', days: n, too_early: true };
    if (n <= 30) return { band: '14_30', days: n, too_early: false };
    if (n <= 60) return { band: '31_60', days: n, too_early: false };
    return { band: 'over_60', days: n, too_early: false };
};

const isExplicitFalse = (value) => value === false || value === 'false' || value === 0;

const isExplicitTrue = (value) => value === true || value === 'true' || value === 1;

const qualitySufficient = (photoStd = {}, imageQualityOk) => {
    if (isExplicitFalse(imageQualityOk)) {
        return { ok: false, reason: 'image_quality_insufficient' };
    }
    if (isExplicitTrue(imageQualityOk)) {
        return { ok: true, reason: null };
    }

    const flags = QUALITY_KEYS.map((key) => photoStd?.[key]);
    const anySet = flags.some((v) => v === true || v === false);
    if (!anySet) {
        return { ok: true, reason: null, unset: true };
    }

    const failed = [];
    if (isExplicitFalse(photoStd.photo_focus)) failed.push('focus_quality');
    if (isExplicitFalse(photoStd.photo_good_light)) failed.push('lighting_quality');
    if (isExplicitFalse(photoStd.photo_full_visible)) failed.push('not_fully_visible');
    if (isExplicitFalse(photoStd.photo_no_filter)) failed.push('filter_suspected');

    if (failed.length) {
        return { ok: false, reason: failed[0], failed };
    }
    return { ok: true, reason: null };
};

const comparabilityCheck = (value, failReason) => {
    if (isExplicitFalse(value)) {
        return { ok: false, unset: false, reason: failReason };
    }
    if (isExplicitTrue(value)) {
        return { ok: true, unset: false, reason: null };
    }
    return { ok: true, unset: true, reason: null };
};

const computeComparisonEligible = (input = {}) => {
    const dayWindow = resolveDayWindow(input.days_since_previous);
    const quality = qualitySufficient(input.photo_std_intake, input.image_quality_ok);
    const angle = comparabilityCheck(input.photo_same_angle, 'angle_not_comparable');
    const distance = comparabilityCheck(input.photo_same_distance, 'distance_not_comparable');
    const light = comparabilityCheck(input.photo_comparable_light, 'light_not_comparable');

    const checks = {
        initial_photo: Boolean(input.has_initial_photo),
        follow_up_photo: Boolean(input.has_follow_up_photo),
        same_region: input.same_region !== false,
        sufficient_quality: quality.ok,
        comparable_angle: angle.ok,
        comparable_section: distance.ok,
        comparable_light: light.ok,
        not_too_early: !dayWindow.too_early,
    };

    const reasons = [];
    if (!checks.initial_photo) reasons.push('missing_initial_photo');
    if (!checks.follow_up_photo) reasons.push('missing_follow_up_photo');
    if (!checks.same_region) reasons.push('region_mismatch');
    if (!checks.sufficient_quality) reasons.push(quality.reason || 'image_quality_insufficient');
    if (!checks.comparable_angle) reasons.push(angle.reason);
    if (!checks.comparable_section) reasons.push(distance.reason);
    if (!checks.comparable_light) reasons.push(light.reason);
    if (!checks.not_too_early) reasons.push('too_early');

    const comparison_eligible = Object.values(checks).every(Boolean);
    const unsetComparability = angle.unset || distance.unset || light.unset || quality.unset;
    let uncertainty_level = 'low';
    if (!comparison_eligible) uncertainty_level = 'high';
    else if (unsetComparability || dayWindow.band === 'unknown') uncertainty_level = 'medium';

    const coverup = input.coverup_level || 'none';
    if (coverup === 'multiple' || coverup === 'unknown') {
        uncertainty_level = uncertainty_level === 'low' ? 'medium' : uncertainty_level;
    }

    return {
        comparison_eligible,
        uncertainty_level,
        needs_human_review: !comparison_eligible || uncertainty_level !== 'low',
        customer_progress_visible: comparison_eligible,
        reasons,
        checks,
        day_window: dayWindow,
        customer_message: comparison_eligible
            ? null
            : dayWindow.too_early
              ? 'too_early'
              : 'no_reliable_comparison',
    };
};

const daysBetween = (from, to = new Date()) => {
    if (!from) return null;
    const start = new Date(from);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(to);
    if (Number.isNaN(end.getTime())) return null;
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
};

module.exports = {
    computeComparisonEligible,
    resolveDayWindow,
    daysBetween,
};

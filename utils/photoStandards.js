/**
 * Photo_Standards (Master Excel) — intake required flags.
 * Failed or empty required flags still allow calculation, but raise
 * uncertainty and needs_human_review (README_ClaudeCode + Flow_Mapping).
 */

const INTAKE_REQUIRED = [
    { flag: 'photo_full_visible', trigger: 'photo_full_visible' },
    { flag: 'photo_good_light', trigger: 'photo_good_light' },
    { flag: 'photo_focus', trigger: 'photo_focus' },
    { flag: 'photo_distance', trigger: 'photo_distance' },
    { flag: 'photo_no_filter', trigger: 'photo_no_filter' },
];

const hasIntakePhoto = (caseInput = {}) =>
    Boolean(caseInput.photo_intake_main || caseInput.photo_intake_detail);

const assessIntakePhotoStandards = (caseInput = {}) => {
    const std = caseInput.photo_std_intake || {};
    const hasPhoto = hasIntakePhoto(caseInput);
    const triggers = [];

    if (!hasPhoto) {
        triggers.push('missing_intake_photo');
    } else {
        INTAKE_REQUIRED.forEach((rule) => {
            if (std[rule.flag] !== true) triggers.push(rule.trigger);
        });
    }

    const failed = triggers.length;
    const image_quality_ok = hasPhoto && failed === 0;
    const image_quality_score = Math.max(0, 100 - failed * 20);

    return {
        needs_human_review: failed > 0,
        triggers,
        image_quality_ok,
        image_quality_score,
        comparison_eligible_flag: image_quality_ok,
    };
};

module.exports = {
    INTAKE_REQUIRED,
    hasIntakePhoto,
    assessIntakePhotoStandards,
};

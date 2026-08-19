/**
 * Shared review envelope for auto-calculated engines (IT_Clarifications §10).
 * Empty fields still calculate; uncertainty and needs_human_review increase.
 */

const { assessIntakePhotoStandards } = require('./photoStandards');
const { CASE_TYPE } = require('../config/constants');

const unique = (items = []) => [...new Set(items.filter(Boolean))];

const collectMissingEstimateFields = (caseInput = {}) => {
    if (caseInput.type === CASE_TYPE.PMU) return [];

    const missing = [];
    if (!caseInput.tc_size_length || !caseInput.tc_size_width) missing.push('missing_size');
    if (!(caseInput.tc_colors_present || []).length) missing.push('missing_colors');
    if (!(caseInput.skin_fitzpatrick_type || caseInput.skin_fitzpatrick)) {
        missing.push('missing_fitzpatrick');
    }
    if (
        !(
            caseInput.tc_body_location_main ||
            caseInput.tc_body_location ||
            caseInput.koerperstelle
        )
    ) {
        missing.push('missing_location');
    }
    if (!caseInput.tc_age_bucket && caseInput.tc_age_years == null) {
        missing.push('missing_age');
    }
    return missing;
};

const attachEstimateReview = (preview, caseInput = {}) => {
    const sessions = preview.sessions || {};
    const photo = assessIntakePhotoStandards(caseInput);
    const missing = collectMissingEstimateFields(caseInput);
    const review_triggers = unique([
        ...(sessions.review_triggers || []),
        ...(preview.review_triggers || []),
        ...missing,
        ...photo.triggers,
    ]);
    const needs_human_review =
        Boolean(sessions.needs_human_review) ||
        Boolean(preview.needs_human_review) ||
        photo.needs_human_review ||
        missing.length > 0 ||
        review_triggers.length > 0;

    return {
        ...preview,
        needs_human_review,
        review_triggers,
        photo_standards: photo,
    };
};

const CUSTOMER_INTERNAL_KEYS = [
    'multipliers',
    'rawPrice',
    'basePricePerCm2',
    'minPrice',
    'review_triggers',
    'needs_human_review',
    'photo_standards',
    'zonen',
];

const stripCustomerInternalKeys = (payload) => {
    const next = { ...payload };
    CUSTOMER_INTERNAL_KEYS.forEach((key) => {
        delete next[key];
    });
    if (next.sessions && typeof next.sessions === 'object') {
        next.sessions = {
            min: next.sessions.min,
            max: next.sessions.max,
        };
    }
    return next;
};

module.exports = {
    unique,
    collectMissingEstimateFields,
    attachEstimateReview,
    CUSTOMER_INTERNAL_KEYS,
    stripCustomerInternalKeys,
};

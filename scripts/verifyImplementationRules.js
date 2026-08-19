/**
 * Master Excel IT_Clarifications §10 — implementation rules.
 * Usage: node scripts/verifyImplementationRules.js
 */
const { DOMAIN_SOURCE_OF_TRUTH } = require('../config/domainSourceOfTruth');
const { calculateCasePreview, formatCustomerPreview } = require('../utils/pricingEngine');
const { CUSTOMER_INTERNAL_KEYS } = require('../utils/engineReview');
const { assessIntakePhotoStandards } = require('../utils/photoStandards');
const {
    computeHealingAssessment,
    applyStudioHealingCorrection,
} = require('../utils/healingLogicEngine');

const failed = [];

const assert = (ok, id, message) => {
    if (!ok) failed.push(`${id}: ${message}`);
};

assert(
    DOMAIN_SOURCE_OF_TRUTH.precedence[0] === 'IT_Clarifications',
    'precedence',
    'IT_Clarifications must be first'
);
assert(
    DOMAIN_SOURCE_OF_TRUTH.review_principle.studio_review_required === true,
    'review_principle',
    'studio review/correction must remain provided'
);
assert(
    DOMAIN_SOURCE_OF_TRUTH.review_principle.customer_hides_internal_params === true,
    'customer_hide',
    'internal params must stay hidden from customers'
);

const emptyPreview = calculateCasePreview({ type: 'tattoo' });
assert(emptyPreview.needs_human_review === true, 'empty_fields', 'empty intake must set needs_human_review');
assert(
    (emptyPreview.review_triggers || []).includes('missing_size'),
    'empty_size',
    `expected missing_size, got ${emptyPreview.review_triggers}`
);
assert(
    emptyPreview.pricePerSession > 0 && emptyPreview.sessions.min > 0,
    'still_calculates',
    'empty fields must still produce a price and session range'
);

const customer = formatCustomerPreview(emptyPreview);
CUSTOMER_INTERNAL_KEYS.forEach((key) => {
    assert(!(key in customer), 'customer_preview', `customer payload must not include ${key}`);
});
assert(!customer.sessions?.lifestyle_multiplier, 'customer_sessions', 'customer must not see lifestyle multiplier');
assert(!customer.sessions?.top_factors, 'customer_factors', 'customer must not see top_factors');

const photoFail = assessIntakePhotoStandards({
    photo_intake_main: 'file-1',
    photo_std_intake: { photo_full_visible: false, photo_focus: true },
});
assert(photoFail.needs_human_review === true, 'photo_std', 'failed Photo_Standards must need review');
assert(
    photoFail.triggers.includes('photo_full_visible'),
    'photo_full',
    'tattoo-not-fully-visible must be a trigger'
);

const photoOk = assessIntakePhotoStandards({
    photo_intake_main: 'file-1',
    photo_std_intake: {
        photo_full_visible: true,
        photo_good_light: true,
        photo_focus: true,
        photo_distance: true,
        photo_no_filter: true,
    },
});
assert(photoOk.image_quality_ok === true, 'photo_ok', 'all required intake flags true → quality ok');

const healing = computeHealingAssessment({});
assert(healing.needs_human_review === true, 'healing_unknown', 'unknown window needs studio review');
assert(healing.studio_kontakt === false, 'healing_no_alarm', 'unknown window alone must not push studio contact');

const corrected = applyStudioHealingCorrection(
    { healing_phase: 'healing', healing_status: 'conspicuous' },
    'normal'
);
assert(corrected.healing_status === 'normal', 'studio_correct', 'studio must be able to correct healing status');
assert(corrected.healing_needs_review === false, 'studio_review_clears', 'review should clear needs_review');
assert(corrected.ampel === 'gruen', 'studio_ampel', 'corrected normal status maps to green');

if (failed.length) {
    failed.forEach((line) => console.error(`FAIL  ${line}`));
    process.exit(1);
}

console.log('PASS  source-of-truth order');
console.log('PASS  empty fields still calculate + needs_human_review');
console.log('PASS  customer preview hides multipliers/weights');
console.log('PASS  Photo_Standards intake review flags');
console.log('PASS  healing unknown window + studio correction');
console.log('\nAll §10 implementation rules hold.');

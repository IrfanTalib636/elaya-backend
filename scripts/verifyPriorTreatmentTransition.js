const fs = require('fs');
const path = require('path');
const Case = require('../models/caseModel');
const {
    createCaseSchema,
    updateCaseSchema,
} = require('../validators/caseValidator');
const { syncDerivedIntakeFields } = require('../utils/caseIntakeHelpers');
const { formatCase } = require('../controllers/caseController');
const lockoutSrc = fs.readFileSync(
    path.join(__dirname, '../utils/lockoutEngine.js'),
    'utf8'
);
const sessionHelpersSrc = fs.readFileSync(
    path.join(__dirname, '../utils/sessionHelpers.js'),
    'utf8'
);

let passed = 0;
let failed = 0;

const check = (ok, label, detail = '') => {
    if (ok) {
        passed += 1;
        console.log(`PASS  ${label}`);
    } else {
        failed += 1;
        console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
};

console.log('verifyPriorTreatmentTransition — prior laser outside ELAYA\n');

console.log('=== Schema ===');
const paths = Case.schema.paths;
check(!!paths.tc_prior_treatment, 'Case has tc_prior_treatment');
check(!!paths.tc_prior_treatment_count, 'Case has tc_prior_treatment_count');
check(!!paths.tc_prior_last_treatment_date, 'Case has tc_prior_last_treatment_date');
check(!!paths.tc_prior_studio, 'Case has tc_prior_studio');
check(!!paths.elaya_tracking_started_at, 'Case has elaya_tracking_started_at');
check(!!paths.sessionsDone, 'Case has sessionsDone');

console.log('\n=== Validator ===');
const okPrior = createCaseSchema.safeParse({
    case_id: undefined,
    type: 'tattoo',
    treatment_date: undefined,
    tc_prior_treatment: true,
    tc_prior_treatment_count: 4,
    tc_prior_last_treatment_date: '2026-01-15',
    tc_prior_studio: 'INKFREE',
});
check(okPrior.success, 'create accepts prior yes + count + last date', okPrior.error && JSON.stringify(okPrior.error.issues));

const missingDate = createCaseSchema.safeParse({
    type: 'tattoo',
    tc_prior_treatment: true,
    tc_prior_treatment_count: 4,
});
check(!missingDate.success, 'create rejects prior yes without last date');

const missingCount = createCaseSchema.safeParse({
    type: 'tattoo',
    tc_prior_treatment: true,
    tc_prior_last_treatment_date: '2026-01-15',
});
check(!missingCount.success, 'create rejects prior yes without count');

const noPrior = createCaseSchema.safeParse({
    type: 'tattoo',
    tc_prior_treatment: false,
});
check(noPrior.success, 'create accepts prior no without extra fields');

const futureDate = createCaseSchema.safeParse({
    type: 'tattoo',
    tc_prior_treatment: true,
    tc_prior_treatment_count: 2,
    tc_prior_last_treatment_date: '2099-01-01',
});
check(!futureDate.success, 'create rejects future last treatment date');

const updateOk = updateCaseSchema.safeParse({
    tc_prior_treatment: true,
    tc_prior_treatment_count: 3,
    tc_prior_last_treatment_date: '2025-06-01',
});
check(updateOk.success, 'update accepts complete prior patch');

console.log('\n=== syncDerivedIntakeFields ===');
const cleared = syncDerivedIntakeFields({
    tc_prior_treatment: false,
    tc_prior_treatment_count: 4,
    tc_prior_last_treatment_date: '2025-01-01',
    tc_prior_studio: 'INKFREE',
});
check(cleared.tc_prior_treatment_count === null, 'prior=false clears count');
check(cleared.tc_prior_last_treatment_date === null, 'prior=false clears last date');
check(cleared.tc_prior_studio === '', 'prior=false clears studio');

console.log('\n=== formatCase aliases ===');
const formatted = formatCase(
    {
        _id: '507f1f77bcf86cd799439011',
        tc_prior_treatment: true,
        tc_prior_treatment_count: 4,
        tc_prior_last_treatment_date: new Date('2025-06-01'),
        tc_prior_studio: 'INKFREE',
        elaya_tracking_started_at: new Date('2026-03-01'),
        sessionsDone: 0,
        estimate_confirmation: {},
    },
    [],
    'customer'
);
check(formatted.prior_treatments_before_elaya === 4, 'prior_treatments_before_elaya = 4');
check(formatted.elaya_sessions_done === 0, 'elaya_sessions_done = sessionsDone (0)');
check(formatted.sessionsDone === 0, 'sessionsDone stays 0 (not seeded from prior)');
check(!!formatted.tc_prior_last_treatment_date, 'exposes tc_prior_last_treatment_date');
check(!!formatted.elaya_tracking_started_at, 'exposes elaya_tracking_started_at');

console.log('\n=== Lockout / sessionsDone isolation ===');
check(
    lockoutSrc.includes('tc_prior_last_treatment_date'),
    'lockoutEngine reads tc_prior_last_treatment_date'
);
check(
    lockoutSrc.includes('Vorbehandlung'),
    'lockout labels prior treatment reference'
);
check(
    !/sessionsDone\s*=\s*.*tc_prior_treatment_count/.test(sessionHelpersSrc) &&
        !/tc_prior_treatment_count[\s\S]{0,80}sessionsDone/.test(sessionHelpersSrc),
    'sessionHelpers does not seed sessionsDone from prior count'
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

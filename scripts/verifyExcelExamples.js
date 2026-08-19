/**
 * Verify Master Excel IT_Clarifications §7 examples against the live engines.
 * Usage: node scripts/verifyExcelExamples.js
 */
const { runExcelPlausibilityCheck } = require('../utils/plausibilityCheck');

const report = runExcelPlausibilityCheck();

for (const row of report.results) {
    const mark = row.pass ? 'PASS' : 'FAIL';
    console.log(`${mark}  ${row.id}  ${row.title}`);
    console.log(
        `      got  CHF ${row.got.price_per_session}  sessions ${row.got.sessions_min}–${row.got.sessions_max}  total ${row.got.total_min}–${row.got.total_max}`
    );
    console.log(
        `      exp  CHF ${row.expected.price_per_session}  sessions ${row.expected.sessions_min}–${row.expected.sessions_max}  total ${row.expected.total_min}–${row.expected.total_max}`
    );
    if (!row.pass) {
        for (const miss of row.mismatches) {
            console.log(`      mismatch ${miss.field}: got ${miss.got} expected ${miss.expected}`);
        }
    }
}

if (!report.pass) {
    console.error('\nExcel plausibility check failed.');
    process.exit(1);
}

console.log('\nAll Excel examples match.');

/**
 * Excel Examples / plausibility check (IT_Clarifications §7).
 * Runs the three reference cases through the live price + session engines.
 */

const { EXCEL_PLAUSIBILITY_EXAMPLES } = require('../config/excelPlausibilityExamples');
const { calculateCasePreview } = require('./pricingEngine');

const nearly = (got, expected, eps = 0.02) =>
    Math.abs(Number(got) - Number(expected)) <= eps;

const compareExample = (example, preview) => {
    const expected = example.expected;
    const mismatches = [];

    const checks = [
        ['area', preview.area, expected.area],
        ['price_per_session', preview.pricePerSession, expected.price_per_session],
        ['sessions_min', preview.sessions?.min, expected.sessions_min],
        ['sessions_max', preview.sessions?.max, expected.sessions_max],
        ['total_min', preview.totalMin, expected.total_min],
        ['total_max', preview.totalMax, expected.total_max],
    ];

    for (const [key, got, exp] of checks) {
        if (!nearly(got, exp, key === 'area' ? 0.05 : 0.51)) {
            mismatches.push({ field: key, expected: exp, got });
        }
    }

    if (expected.raw_price != null && !nearly(preview.rawPrice, expected.raw_price)) {
        mismatches.push({
            field: 'raw_price',
            expected: expected.raw_price,
            got: preview.rawPrice,
        });
    }

    if (expected.multipliers && preview.multipliers) {
        for (const [key, exp] of Object.entries(expected.multipliers)) {
            const got = preview.multipliers[key];
            if (!nearly(got, exp, 0.001)) {
                mismatches.push({ field: `multipliers.${key}`, expected: exp, got });
            }
        }
    }

    return {
        id: example.id,
        title: example.title,
        pass: mismatches.length === 0,
        got: {
            area: preview.area,
            raw_price: preview.rawPrice,
            price_per_session: preview.pricePerSession,
            sessions_min: preview.sessions?.min,
            sessions_max: preview.sessions?.max,
            total_min: preview.totalMin,
            total_max: preview.totalMax,
            multipliers: preview.multipliers,
        },
        expected,
        mismatches,
    };
};

const runExcelPlausibilityCheck = (pricingOverrides = {}) => {
    const results = EXCEL_PLAUSIBILITY_EXAMPLES.map((example) => {
        const preview = calculateCasePreview(example.input, pricingOverrides);
        return compareExample(example, preview);
    });

    return {
        pass: results.every((row) => row.pass),
        source: 'IT_Clarifications §7 / Examples',
        results,
    };
};

module.exports = {
    runExcelPlausibilityCheck,
    compareExample,
};

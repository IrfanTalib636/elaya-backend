/**
 * Verifies the live pricing preview: the breakdown must reconstruct the price
 * the engine actually charges, and editing a factor must move it in the
 * expected direction.
 *
 * Run: node scripts/verifyPricingPreview.js
 */
const { previewPricing, checkPricingConfig, calculatePrice } = require('../utils/pricingEngine');
const { EXCEL_PLAUSIBILITY_EXAMPLES } = require('../config/excelPlausibilityExamples');

let failures = 0;

const check = (name, condition, detail = '') => {
    if (condition) {
        console.log(`PASS  ${name}`);
    } else {
        failures += 1;
        console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

const nearly = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

for (const example of EXCEL_PLAUSIBILITY_EXAMPLES) {
    const preview = previewPricing(example.input, {}, { baselinePricing: {} });
    const { live } = preview;
    const bd = live.breakdown;

    check(
        `${example.id} preview price matches the engine`,
        live.pricePerSession === calculatePrice(example.input, {}).pricePerSession,
        `preview ${live.pricePerSession}`
    );

    check(
        `${example.id} preview price matches the reference`,
        live.pricePerSession === example.expected.price_per_session,
        `got ${live.pricePerSession}, expected ${example.expected.price_per_session}`
    );

    // The last running subtotal is the raw price, before rounding and the floor.
    const lastRunning = bd.steps[bd.steps.length - 1].running;
    check(
        `${example.id} breakdown ends at the raw price`,
        nearly(lastRunning, bd.rawPrice),
        `last step ${lastRunning} vs rawPrice ${bd.rawPrice}`
    );

    // Re-multiply the steps and confirm we land on the same raw price, i.e. the
    // breakdown shows the real formula and not a parallel approximation.
    const replayed = bd.steps.reduce(
        (acc, step) => (step.id === 'base' ? bd.area * step.value : acc * step.value),
        0
    );
    check(
        `${example.id} breakdown replays to the raw price`,
        nearly(replayed, bd.rawPrice),
        `replayed ${replayed} vs ${bd.rawPrice}`
    );

    check(
        `${example.id} every multiplier step names its config key`,
        bd.steps.every((s) => s.id === 'density' || typeof s.config_key === 'string'),
        JSON.stringify(bd.steps.map((s) => s.config_key))
    );

    check(
        `${example.id} multiplier values match the reference multipliers`,
        Object.entries(example.expected.multipliers).every(([key, expected]) =>
            nearly(live.multipliers[key], expected, 0.001)
        ),
        JSON.stringify(live.multipliers)
    );
}

// Example 1 is CHF 18 raw but quoted at CHF 90 — the floor, not the formula.
const smallest = previewPricing(EXCEL_PLAUSIBILITY_EXAMPLES[0].input, {});
check(
    'the minimum price is reported when it decides the price',
    smallest.live.breakdown.minPriceApplied === true,
    `rawPrice ${smallest.live.breakdown.rawPrice}`
);
check(
    'the minimum price is not reported when the formula decides',
    previewPricing(EXCEL_PLAUSIBILITY_EXAMPLES[1].input, {}).live.breakdown.minPriceApplied ===
        false
);

// Raising the base price must raise the quote, and the delta must say so.
const dearer = previewPricing(
    EXCEL_PLAUSIBILITY_EXAMPLES[1].input,
    { basePricePerCm2: 6 },
    { baselinePricing: {} }
);
check(
    'doubling the base price raises the price',
    dearer.live.pricePerSession > dearer.baseline.pricePerSession,
    `${dearer.baseline.pricePerSession} -> ${dearer.live.pricePerSession}`
);
check(
    'the delta reports the increase',
    dearer.delta.pricePerSession ===
        dearer.live.pricePerSession - dearer.baseline.pricePerSession,
    JSON.stringify(dearer.delta)
);

// A zero multiplier is the mistake this preview exists to catch.
const zeroed = checkPricingConfig({ depth_normal: 0 });
check(
    'a zero multiplier is reported as an error',
    !zeroed.ok &&
        zeroed.issues.some(
            (i) => i.key === 'depth_normal' && i.severity === 'error'
        ),
    JSON.stringify(zeroed.issues)
);
check(
    'a zero base price is reported as an error',
    checkPricingConfig({ basePricePerCm2: 0 }).issues.some(
        (i) => i.key === 'basePricePerCm2' && i.severity === 'error'
    )
);
check(
    'an unusually high multiplier is reported as a warning only',
    (() => {
        const r = checkPricingConfig({ color_multi: 40 });
        return r.ok && r.issues.some((i) => i.key === 'color_multi' && i.severity === 'warning');
    })()
);
check('the shipped defaults are clean', checkPricingConfig({}).ok);

// PMU is a flat price, so its breakdown is a single row and never multiplied.
const pmu = previewPricing({ type: 'pmu' }, { pmuPrice: 200 });
check(
    'PMU previews the flat price as one step',
    pmu.live.pricePerSession === 200 && pmu.live.breakdown.steps.length === 1,
    JSON.stringify(pmu.live.breakdown)
);

console.log(failures === 0 ? '\nPricing preview OK.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);

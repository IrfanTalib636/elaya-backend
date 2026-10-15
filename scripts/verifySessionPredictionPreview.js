/**
 * Quick check: live Sitzungsprognose preview reflects parameter changes.
 * Usage: node scripts/verifySessionPredictionPreview.js
 */
const { previewSessionPrediction } = require('../utils/sessionPredictionEngine');
const { DEFAULT_SESSION_PREDICTION } = require('../config/sessionPredictionDefaults');
const { EXCEL_PLAUSIBILITY_EXAMPLES } = require('../config/excelPlausibilityExamples');

const example1 = EXCEL_PLAUSIBILITY_EXAMPLES.find((e) => e.id === 'example_1').input;
const failed = [];

const assert = (ok, msg) => {
    if (!ok) failed.push(msg);
};

const baseline = previewSessionPrediction(example1, DEFAULT_SESSION_PREDICTION, {
    baselinePrediction: DEFAULT_SESSION_PREDICTION,
});
assert(baseline.live.min === 6 && baseline.live.max === 8, `example_1 expected 6–8 got ${baseline.live.min}–${baseline.live.max}`);
assert(baseline.live.formula?.base_sessions === 8, 'formula.base_sessions missing');
assert(Array.isArray(baseline.live.factors), 'factors array required');

const raisedBase = previewSessionPrediction(
    example1,
    { ...DEFAULT_SESSION_PREDICTION, base_sessions: 10 },
    { baselinePrediction: DEFAULT_SESSION_PREDICTION }
);
assert(raisedBase.live.min > baseline.live.min, 'raising base_sessions must increase min');
assert(raisedBase.delta.sessions_min > 0, 'delta.sessions_min should be positive');

const harderColor = previewSessionPrediction(
    { ...example1, tc_colors_present: ['yellow', 'white'] },
    DEFAULT_SESSION_PREDICTION,
    { baselinePrediction: DEFAULT_SESSION_PREDICTION }
);
assert(
    harderColor.live.min >= baseline.live.min,
    'difficult colors should not lower sessions vs simple black'
);

const unknownDensityCfg = {
    ...DEFAULT_SESSION_PREDICTION,
    tattoo_deltas: {
        ...DEFAULT_SESSION_PREDICTION.tattoo_deltas,
        density: { low: 0, medium: 4, high: 1, very_high: 2, unknown: 0 },
        shading: { none: 0, low: 0, medium: 0, high: 3, unknown: 0 },
        linework: { fine: 0, medium: 0, bold: 0, mixed: 0, unknown: 0 },
    },
};
const mediumDensity = previewSessionPrediction(
    { ...example1, tc_density: 'medium' },
    unknownDensityCfg,
    { baselinePrediction: unknownDensityCfg }
);
const unknownDensity = previewSessionPrediction(
    { ...example1, tc_density: 'unknown' },
    unknownDensityCfg,
    { baselinePrediction: unknownDensityCfg }
);
assert(
    unknownDensity.live.tattoo_delta !== mediumDensity.live.tattoo_delta,
    'unknown density must not reuse the medium delta'
);

const shadingOn = previewSessionPrediction(
    { ...example1, tc_shading: 'high' },
    unknownDensityCfg,
    { baselinePrediction: DEFAULT_SESSION_PREDICTION }
);
assert(
    shadingOn.live.tattoo_delta > baseline.live.tattoo_delta,
    'published shading delta must change the session forecast'
);

if (failed.length) {
    failed.forEach((line) => console.error(`FAIL  ${line}`));
    process.exit(1);
}

console.log(`PASS  baseline example_1 → ${baseline.live.min}–${baseline.live.max}`);
console.log(
    `PASS  base_sessions 8→10 → ${raisedBase.baseline.min}–${raisedBase.baseline.max} → ${raisedBase.live.min}–${raisedBase.live.max} (Δ ${raisedBase.delta.sessions_min}/${raisedBase.delta.sessions_max})`
);
console.log('PASS  formula + factors present on live preview');
console.log('\nSession prediction live preview OK.');

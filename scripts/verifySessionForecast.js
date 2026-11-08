/**
 * Unit checks for progress-based session-range forecast.
 */
const {
    expectedFadeAfterSessions,
    classifyFadePace,
    computeSessionForecast,
    applySessionForecastToCase,
    formatSessionForecastFields,
    resolveOriginalRange,
    adjustRangeForPace,
    resolveBaselinePhotoFileId,
} = require('../utils/sessionForecastFromProgress');
const Case = require('../models/caseModel');

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

const run = async () => {
    console.log('verifySessionForecast — expected vs actual pace + range adjust\n');

    console.log('=== expected fade ===');
    check(expectedFadeAfterSessions(2, 1) === 20, '2 sessions × 10% × 1.0 → 20%');
    check(expectedFadeAfterSessions(3, 1) === 30, '3 sessions × 10% × 1.0 → 30%');
    check(expectedFadeAfterSessions(2, 0.8) === 16, 'visibility factor scales expected fade');

    console.log('\n=== pace classification ===');
    check(classifyFadePace(8, 20) === 'slow', '8% after 2 (expected 20) → slow');
    check(classifyFadePace(38, 30) === 'fast', '38% after 3 (expected 30) → fast');
    check(classifyFadePace(22, 20) === 'expected', 'near expected → expected');
    check(classifyFadePace(5, 20) === 'stagnant', 'very low ratio → stagnant');

    console.log('\n=== range adjustment ===');
    const slowAdj = adjustRangeForPace(10, 14, 'slow');
    check(slowAdj.min >= 10, `slow raises or keeps min (got ${slowAdj.min}–${slowAdj.max})`);
    check(slowAdj.max >= 14, `slow raises or keeps max (got ${slowAdj.min}–${slowAdj.max})`);

    const fastAdj = adjustRangeForPace(10, 14, 'fast');
    check(fastAdj.max <= 14, `fast lowers or keeps max (got ${fastAdj.min}–${fastAdj.max})`);
    check(fastAdj.delta < 0, 'fast applies negative lightening delta');

    console.log('\n=== compute forecast eligibility ===');
    const baseCase = {
        sessionsMin: 10,
        sessionsMax: 14,
        estimate_confirmation: { status: 'angepasst', sessionsMin: 10, sessionsMax: 14 },
        tc_colors_present: ['black', 'red'],
        tc_density: 'medium',
        tc_saturation: 'medium',
        tc_coverup: 'none',
    };

    const rejectedEarly = computeSessionForecast({
        caseDoc: baseCase,
        sessionsDone: 1,
        actualFadePct: 8,
        comparisonEligible: true,
        customerProgressVisible: true,
    });
    check(rejectedEarly === null, 'rejects when sessionsDone < 2');

    const rejectedIneligible = computeSessionForecast({
        caseDoc: baseCase,
        sessionsDone: 2,
        actualFadePct: 8,
        comparisonEligible: false,
        customerProgressVisible: false,
    });
    check(rejectedIneligible === null, 'rejects when comparison not eligible');

    const slowForecast = computeSessionForecast({
        caseDoc: baseCase,
        sessionsDone: 2,
        actualFadePct: 8,
        comparisonEligible: true,
        customerProgressVisible: true,
        sourceSessionId: 'abc',
    });
    check(!!slowForecast, 'computes forecast for slow 8% after 2');
    check(slowForecast.sessions_forecast_meta.pace === 'slow', 'meta.pace is slow');
    check(
        slowForecast.should_freeze_original === true,
        'freezes original from confirmation on first run'
    );
    check(
        slowForecast.original_sessionsMin === 10 && slowForecast.original_sessionsMax === 14,
        'original stays 10–14'
    );
    check(
        slowForecast.current_sessionsMax >= 14,
        `current max rises for slow pace (got ${slowForecast.current_sessionsMin}–${slowForecast.current_sessionsMax})`
    );
    check(
        slowForecast.remaining_sessionsMin ===
            Math.max(0, slowForecast.current_sessionsMin - 2),
        'remaining = current − done'
    );

    const fastForecast = computeSessionForecast({
        caseDoc: {
            ...baseCase,
            original_sessionsMin: 10,
            original_sessionsMax: 14,
        },
        sessionsDone: 3,
        actualFadePct: 38,
        comparisonEligible: true,
        customerProgressVisible: true,
    });
    check(!!fastForecast, 'computes forecast for fast 38% after 3');
    check(fastForecast.sessions_forecast_meta.pace === 'fast', 'meta.pace is fast');
    check(fastForecast.should_freeze_original === false, 'does not re-freeze when original set');
    check(
        fastForecast.current_sessionsMax <= 14,
        `current max improves for fast pace (got ${fastForecast.current_sessionsMin}–${fastForecast.current_sessionsMax})`
    );
    check(fastForecast.current_sessionsMax >= 3, 'current max >= sessions done');

    console.log('\n=== format fields / confirmation untouched ===');
    const formatted = formatSessionForecastFields({
        sessionsDone: 3,
        sessionsMin: 10,
        sessionsMax: 14,
        original_sessionsMin: 10,
        original_sessionsMax: 14,
        current_sessionsMin: 8,
        current_sessionsMax: 11,
        estimate_confirmation: { status: 'angepasst', sessionsMin: 10, sessionsMax: 14 },
    });
    check(formatted.original_sessionsMin === 10, 'format exposes original min');
    check(formatted.current_sessionsMax === 11, 'format exposes current max');
    check(formatted.remaining_sessionsMin === 5, 'remaining min 8-3=5');
    check(formatted.remaining_sessionsMax === 8, 'remaining max 11-3=8');

    const orig = resolveOriginalRange({
        estimate_confirmation: { status: 'bestaetigt', sessionsMin: 10, sessionsMax: 14 },
        sessionsMin: 9,
        sessionsMax: 13,
    });
    check(orig.min === 10 && orig.max === 14, 'prefer confirmed range as original source');

    console.log('\n=== apply mutates forecast only ===');
    const mutable = {
        sessionsMin: 10,
        sessionsMax: 14,
        sessionsDone: 2,
        removal: 8,
        estimate_confirmation: {
            status: 'angepasst',
            sessionsMin: 10,
            sessionsMax: 14,
            pricePerSession: 120,
        },
        pricePerSession: 120,
        calculated_sessionsMin: 9,
        calculated_sessionsMax: 13,
        tc_colors_present: ['black'],
        tc_density: 'medium',
        tc_saturation: 'medium',
        tc_coverup: 'none',
    };
    const confBefore = JSON.stringify(mutable.estimate_confirmation);
    const priceBefore = mutable.pricePerSession;
    const calcBefore = `${mutable.calculated_sessionsMin}-${mutable.calculated_sessionsMax}`;

    const applied = await applySessionForecastToCase(mutable, {
        sessionsDone: 2,
        actualFadePct: 8,
        comparisonEligible: true,
        customerProgressVisible: true,
        sourceSessionId: 'sess1',
    });
    check(!!applied, 'applySessionForecastToCase returns forecast');
    check(mutable.original_sessionsMin === 10, 'apply freezes original min on case');
    check(mutable.current_sessionsMax >= 14, 'apply writes current max on case');
    check(!!mutable.sessions_forecast_updated_at, 'apply sets sessions_forecast_updated_at');
    check(
        mutable.sessions_forecast_meta?.pace === 'slow',
        'apply writes pace meta'
    );
    check(
        JSON.stringify(mutable.estimate_confirmation) === confBefore,
        'apply does not mutate estimate_confirmation'
    );
    check(mutable.pricePerSession === priceBefore, 'apply does not mutate pricePerSession');
    check(
        `${mutable.calculated_sessionsMin}-${mutable.calculated_sessionsMax}` === calcBefore,
        'apply does not mutate calculated_* snapshot'
    );
    check(mutable.sessionsMin === 10 && mutable.sessionsMax === 14, 'apply leaves live sessionsMin/Max');

    console.log('\n=== baseline photo helper ===');
    check(
        resolveBaselinePhotoFileId({ photo_intake_main: '507f1f77bcf86cd799439011' }) ===
            '507f1f77bcf86cd799439011',
        'baseline from photo_intake_main'
    );
    check(
        resolveBaselinePhotoFileId({ photo_intake_main: 'data:image/jpeg;base64,xxx' }) === null,
        'rejects data-URI intake as baseline file id'
    );
    check(
        resolveBaselinePhotoFileId({}, [{ foto_url: '507f1f77bcf86cd799439022' }]) ===
            '507f1f77bcf86cd799439022',
        'baseline falls back to zone foto_url'
    );
    check(
        resolveBaselinePhotoFileId({}, [{ foto_url: 'https://cdn.example/x.jpg' }]) === null,
        'rejects http zone urls as file ids'
    );

    console.log('\n=== case schema paths ===');
    const paths = Case.schema.paths;
    for (const key of [
        'original_sessionsMin',
        'original_sessionsMax',
        'current_sessionsMin',
        'current_sessionsMax',
        'sessions_forecast_updated_at',
        'sessions_forecast_meta',
    ]) {
        check(!!paths[key], `Case schema has ${key}`);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});

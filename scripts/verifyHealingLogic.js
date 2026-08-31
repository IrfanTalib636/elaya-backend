/**
 * Master Excel IT_Clarifications §9 + HealingLogic_Master fixtures.
 */
const { computeHealingAssessment } = require('../utils/healingLogicEngine');

const cases = [
    {
        id: 'early_mild_normal',
        title: 'Day 3 mild redness/swelling stays normal',
        input: {
            days_since_session: 3,
            erythema_level: 'mild',
            swelling_level: 'mild',
            crusting_level: 'mild',
        },
        expect: { healing_status: 'normal', healing_phase: 'early', red_flag: false },
    },
    {
        id: 'late_no_symptoms_normal',
        title: 'Day 25 with no symptoms is not delayed',
        input: { days_since_session: 25 },
        expect: { healing_status: 'normal', healing_phase: 'consolidation', red_flag: false },
    },
    {
        id: 'late_persistent_delayed',
        title: 'Day 25 persistent crusting is delayed',
        input: {
            days_since_session: 25,
            crusting_level: 'moderate',
            progress_direction_self: 'same',
        },
        expect: { healing_status: 'delayed', healing_phase: 'consolidation', needs_human_review: true },
    },
    {
        id: 'blister_red_flag',
        title: 'Blisters override the early window',
        input: { days_since_session: 2, blistering_flag: true },
        expect: { healing_status: 'conspicuous', needs_human_review: true, red_flag: true },
    },
    {
        id: 'high_pain_red_flag',
        title: 'Pain ≥8 is a red flag',
        input: { days_since_session: 5, pain_score: 8 },
        expect: { healing_status: 'conspicuous', needs_human_review: true },
    },
    {
        id: 'healing_worse_monitor',
        title: 'Day 12 worsening symptoms need review',
        input: {
            days_since_session: 12,
            erythema_level: 'moderate',
            swelling_level: 'mild',
            progress_direction_self: 'worse',
        },
        expect: { healing_phase: 'healing', needs_human_review: true },
        status_in: ['monitor', 'conspicuous'],
    },
    {
        id: 'healing_improving_normal',
        title: 'Day 12 improving mild symptoms are normal',
        input: {
            days_since_session: 12,
            erythema_level: 'mild',
            progress_direction_self: 'better',
        },
        expect: { healing_status: 'normal', healing_phase: 'healing' },
    },
    {
        id: 'infection_overrides',
        title: 'Suspected infection is conspicuous any day',
        input: { days_since_session: 4, infection_suspected: true },
        expect: { healing_status: 'conspicuous', needs_human_review: true },
    },
    {
        id: 'poor_behavior_monitor',
        title: 'Poor aftercare/sun/scratching raises monitor',
        input: {
            days_since_session: 6,
            sun_avoidance: 'no',
            aftercare_use: 'no',
            scratching_behavior: 'often',
        },
        expect: { healing_status: 'monitor' },
    },
    {
        id: 'open_lesion_late',
        title: 'Open lesion after 21 days is delayed or conspicuous',
        input: { days_since_session: 28, oozing: true, open_lesion: true },
        expect: { needs_human_review: true },
        status_in: ['delayed', 'conspicuous'],
    },
    {
        id: 'unknown_window_review',
        title: 'Empty days still calculate but need studio review',
        input: { erythema_level: 'mild' },
        expect: {
            healing_phase: 'unknown',
            healing_status: 'normal',
            needs_human_review: true,
            studio_kontakt: false,
        },
    },
];

const failed = [];

for (const item of cases) {
    const got = computeHealingAssessment(item.input);
    const errors = [];
    for (const [key, value] of Object.entries(item.expect)) {
        if (got[key] !== value) {
            errors.push(`${key}: got ${JSON.stringify(got[key])} expected ${JSON.stringify(value)}`);
        }
    }
    if (item.status_in && !item.status_in.includes(got.healing_status)) {
        errors.push(`healing_status ${got.healing_status} not in ${item.status_in}`);
    }
    if (errors.length) {
        failed.push(item.id);
        console.log(`FAIL  ${item.id}  ${item.title}`);
        errors.forEach((err) => console.log(`      ${err}`));
        console.log(`      status=${got.healing_status} flags=${got.red_flags}`);
    } else {
        console.log(`PASS  ${item.id}  ${item.title}`);
    }
}

if (failed.length) {
    console.log(`\n${failed.length} healing checks failed.`);
    process.exit(1);
}

console.log('\nAll healing logic checks match.');

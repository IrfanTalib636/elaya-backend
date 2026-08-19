/**
 * Master Excel IT_Clarifications §8 + LighteningLogic_Master fixtures.
 */
const { computeComparisonEligible } = require('../utils/lighteningComparisonEngine');
const { computeLighteningAssessment } = require('../utils/lighteningLogicEngine');

const comparablePair = {
    has_initial_photo: true,
    has_follow_up_photo: true,
    same_region: true,
    image_quality_ok: true,
    photo_same_angle: true,
    photo_same_distance: true,
    photo_comparable_light: true,
    days_since_previous: 42,
};

const cases = [
    {
        id: 'eligible_visual',
        title: 'Comparable pair shows customer percent',
        input: {
            ...comparablePair,
            colors: ['black'],
            density: 'medium',
            saturation: 'medium',
            coverup: 'none',
            laser_profile_level: 'standard',
            smoker: 'no',
            sleep_quality: 'good',
            stress_level: 'low',
            visual_fade_pct: 40,
            previous_percent: 20,
            sessions_done: 3,
        },
        expect: {
            comparison_eligible: true,
            customer_progress_visible: true,
            percent_estimate: 40,
            lightening_internal_pct: 40,
            progress_direction: 'improving',
            customer_message: null,
        },
    },
    {
        id: 'missing_follow_up',
        title: 'No follow-up photo → no customer percent',
        input: {
            has_initial_photo: true,
            has_follow_up_photo: false,
            same_region: true,
            image_quality_ok: true,
            days_since_previous: 42,
            colors: ['black'],
            visual_fade_pct: 40,
            sessions_done: 2,
        },
        expect: {
            comparison_eligible: false,
            customer_progress_visible: false,
            percent_estimate: null,
            lightening_internal_pct: 40,
            progress_direction: 'unclear',
            customer_message: 'no_reliable_comparison',
            uncertainty_level: 'high',
        },
    },
    {
        id: 'too_early',
        title: 'Under 14 days is too early',
        input: {
            ...comparablePair,
            days_since_previous: 8,
            colors: ['black'],
            visual_fade_pct: 18,
            sessions_done: 1,
        },
        expect: {
            comparison_eligible: false,
            customer_progress_visible: false,
            percent_estimate: null,
            progress_direction: 'unclear',
            customer_message: 'too_early',
        },
    },
    {
        id: 'poor_quality',
        title: 'Poor photo quality blocks comparison',
        input: {
            ...comparablePair,
            image_quality_ok: false,
            colors: ['black'],
            visual_fade_pct: 35,
            sessions_done: 2,
        },
        expect: {
            comparison_eligible: false,
            percent_estimate: null,
            lightening_internal_pct: 35,
            needs_human_review: true,
        },
    },
    {
        id: 'difficult_color_review',
        title: 'Yellow/white triggers human review',
        input: {
            ...comparablePair,
            colors: ['black', 'yellow'],
            density: 'medium',
            saturation: 'medium',
            coverup: 'none',
            smoker: 'no',
            sleep_quality: 'good',
            stress_level: 'low',
            visual_fade_pct: 22,
            sessions_done: 2,
        },
        expect: {
            comparison_eligible: true,
            percent_estimate: 22,
            needs_human_review: true,
            review_has: 'difficult_color',
        },
    },
    {
        id: 'studio_override',
        title: 'Studio review overrides visual percent',
        input: {
            ...comparablePair,
            colors: ['black'],
            density: 'medium',
            saturation: 'medium',
            coverup: 'none',
            smoker: 'no',
            sleep_quality: 'good',
            stress_level: 'low',
            visual_fade_pct: 50,
            studio_review_pct: 44,
            sessions_done: 3,
        },
        expect: {
            comparison_eligible: true,
            percent_estimate: 44,
            lightening_internal_pct: 44,
            studio_reviewed: true,
        },
    },
    {
        id: 'heuristic_only',
        title: 'No visual score stays internal heuristic',
        input: {
            has_initial_photo: false,
            has_follow_up_photo: false,
            days_since_previous: 30,
            colors: ['black'],
            density: 'medium',
            saturation: 'medium',
            coverup: 'none',
            sessions_done: 2,
        },
        expect: {
            comparison_eligible: false,
            percent_estimate: null,
            theoretical: true,
            progress_direction: 'unclear',
        },
    },
];

const failed = [];

for (const item of cases) {
    const comparison = computeComparisonEligible(item.input);
    const got = computeLighteningAssessment({ ...item.input, comparison });
    const exp = item.expect;
    const errors = [];
    for (const [key, value] of Object.entries(exp)) {
        if (key === 'review_has') {
            if (!(got.review_triggers || []).includes(value)) {
                errors.push(`missing review trigger ${value} (got ${got.review_triggers})`);
            }
            continue;
        }
        if (got[key] !== value) {
            errors.push(`${key}: got ${JSON.stringify(got[key])} expected ${JSON.stringify(value)}`);
        }
    }
    if (errors.length) {
        failed.push({ id: item.id, title: item.title, errors, got });
        console.log(`FAIL  ${item.id}  ${item.title}`);
        errors.forEach((err) => console.log(`      ${err}`));
    } else {
        console.log(`PASS  ${item.id}  ${item.title}`);
    }
}

if (failed.length) {
    console.log(`\n${failed.length} lightening checks failed.`);
    process.exit(1);
}

console.log('\nAll lightening logic checks match.');

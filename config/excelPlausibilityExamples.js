/**
 * Master Excel → IT_Clarifications §7 + Examples sheet.
 * These cases are the plausibility check for price × session mechanics.
 * Empty lifestyle = composite score 3 × 1.00 (neutral).
 */

const EXCEL_PLAUSIBILITY_EXAMPLES = [
    {
        id: 'example_1',
        title: 'Small black tattoo',
        input: {
            tc_size_length: 3,
            tc_size_width: 2,
            tc_colors_present: ['black'],
            tc_depth: 'normal',
            tc_age_years: 8,
            skin_fitzpatrick_type: 'II',
            tc_body_location_main: 'arm',
            tc_coverup: 'none',
            goal_target: 'full_removal',
            tc_density: 'medium',
            tc_saturation: 'medium',
        },
        expected: {
            area: 6,
            raw_price: 18,
            price_per_session: 90,
            sessions_min: 6,
            sessions_max: 8,
            total_min: 540,
            total_max: 720,
            multipliers: {
                color: 1,
                depth: 1,
                age: 1,
                skin: 1,
                location: 1,
                layering: 1,
                goal: 1,
            },
        },
    },
    {
        id: 'example_2',
        title: 'Medium colorful tattoo',
        input: {
            tc_size_length: 8,
            tc_size_width: 5,
            tc_colors_present: ['red', 'blue', 'green', 'orange'],
            tc_depth: 'deep',
            tc_age_years: 3,
            skin_fitzpatrick_type: 'III',
            tc_body_location_main: 'arm',
            tc_coverup: 'none',
            goal_target: 'full_removal',
            tc_type: 'professional',
            tc_density: 'medium',
            tc_saturation: 'medium',
        },
        expected: {
            area: 40,
            raw_price: 203.74,
            price_per_session: 205,
            sessions_min: 10,
            sessions_max: 14,
            total_min: 2050,
            total_max: 2870,
            multipliers: {
                color: 1.4,
                depth: 1.1,
                age: 1.05,
                skin: 1.05,
                location: 1,
                layering: 1,
                goal: 1,
            },
        },
    },
    {
        id: 'example_3',
        title: 'Large cover-up on hand',
        input: {
            tc_size_length: 10,
            tc_size_width: 8,
            tc_colors_present: ['black', 'red'],
            tc_age_years: 2,
            skin_fitzpatrick_type: 'IV',
            tc_body_location_main: 'hand',
            tc_coverup: 'multiple',
            goal_target: 'full_removal',
            tc_type: 'professional',
            tc_density: 'medium',
            tc_saturation: 'medium',
        },
        expected: {
            area: 80,
            raw_price: 861.98,
            price_per_session: 865,
            sessions_min: 12,
            sessions_max: 16,
            total_min: 10380,
            total_max: 13840,
            multipliers: {
                color: 1.2,
                depth: 1.3,
                age: 1.1,
                skin: 1.15,
                location: 1.3,
                layering: 1.4,
                goal: 1,
            },
        },
    },
];

module.exports = {
    EXCEL_PLAUSIBILITY_EXAMPLES,
};

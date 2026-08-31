/**
 * Master Excel IT_Clarifications §10 + README_ClaudeCode + Flow_Mapping.
 *
 * CSV exports are technical imports only. If CSV and Master Excel differ,
 * this file (and the Excel it documents) wins.
 *
 * Parameters, weights, scores and multipliers stay internal — customers
 * never see them. Price, sessions, lightening and healing may calculate
 * automatically, but studio review/correction must remain available.
 */

const DOMAIN_SOURCE_OF_TRUTH = {
    precedence: [
        'IT_Clarifications',
        'README_ClaudeCode',
        'PriceFormula / Multipliers / PriceCalculator / Examples',
        '*_Master sheets',
        'questionnaire and progress sheets',
    ],
    csv_vs_excel:
        'CSV files are used for technical imports. If CSV and Master Excel differ, Master Excel plus IT_Clarifications apply.',
    review_principle: {
        engines: ['price', 'sessions', 'lightening', 'healing'],
        auto_calculate: true,
        studio_review_required: true,
        empty_fields: 'still_calculate_increase_uncertainty_set_needs_human_review',
        customer_hides_internal_params: true,
        photos_follow: 'Photo_Standards',
    },
    flow_events: {
        tattoo_case_created: {
            engines: ['price', 'sessions'],
            review_if: ['unclear skin', 'cover-up', 'difficult colors', 'bad photos'],
        },
        intake_photos_uploaded: {
            engines: ['photo_quality', 'session', 'price'],
            review_if: ['focus poor', 'lighting poor', 'tattoo not fully visible'],
        },
        aftercare_submitted: {
            engines: ['healing', 'lightening'],
            review_if: ['blistering', 'severe symptoms', 'suspicious pattern'],
        },
        pre_session_check_submitted: {
            engines: ['session', 'healing_gate'],
            review_if: ['high UV', 'medication changes', 'poor healing'],
        },
        studio_review_saved: {
            engines: ['optionally_recalculate_all'],
            persist: ['corrected values', 'audit'],
        },
        session_completed: {
            engines: ['healing_baseline_reset'],
            persist: ['new treatment timeline'],
        },
    },
};

module.exports = { DOMAIN_SOURCE_OF_TRUTH };

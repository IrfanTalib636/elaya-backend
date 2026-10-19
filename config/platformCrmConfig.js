const { CRM_TASK_TYP, CRM_TASK_PRIORITAET, CRM_NOTE_TYP } = require('./crmDefaults');

const PLATFORM_CRM_STUCK_DAYS = 7;

const PLATFORM_CRM_SUBJECT_TYPE = {
    CUSTOMER: 'customer',
    STUDIO_LEAD: 'studio_lead',
    STUDIO: 'studio',
};

const PLATFORM_CRM_SUBJECT_TYPES = Object.values(PLATFORM_CRM_SUBJECT_TYPE);

const CUSTOMER_FUNNEL_STAGE = {
    REGISTERED: 'registered',
    STUDIO_SELECTED: 'studio_selected',
    CASE_STARTED: 'case_started',
    CASE_CREATED: 'case_created',
    APPOINTMENT_BOOKED: 'appointment_booked',
    FIRST_TREATMENT: 'first_treatment',
    TREATMENT_ACTIVE: 'treatment_active',
    COMPLETED: 'completed',
};

const CUSTOMER_FUNNEL_STAGE_ORDER = [
    CUSTOMER_FUNNEL_STAGE.REGISTERED,
    CUSTOMER_FUNNEL_STAGE.STUDIO_SELECTED,
    CUSTOMER_FUNNEL_STAGE.CASE_STARTED,
    CUSTOMER_FUNNEL_STAGE.CASE_CREATED,
    CUSTOMER_FUNNEL_STAGE.APPOINTMENT_BOOKED,
    CUSTOMER_FUNNEL_STAGE.FIRST_TREATMENT,
    CUSTOMER_FUNNEL_STAGE.TREATMENT_ACTIVE,
    CUSTOMER_FUNNEL_STAGE.COMPLETED,
];

const STUDIO_FUNNEL_STAGE = {
    LEAD: 'lead',
    REGISTRATION_STARTED: 'registration_started',
    REGISTRATION_COMPLETED: 'registration_completed',
    VERIFICATION_PENDING: 'verification_pending',
    CONTRACT_PENDING: 'contract_pending',
    ONBOARDING_STARTED: 'onboarding_started',
    ONBOARDING_INCOMPLETE: 'onboarding_incomplete',
    ACTIVE: 'active',
};

const STUDIO_FUNNEL_STAGE_ORDER = [
    STUDIO_FUNNEL_STAGE.LEAD,
    STUDIO_FUNNEL_STAGE.REGISTRATION_STARTED,
    STUDIO_FUNNEL_STAGE.REGISTRATION_COMPLETED,
    STUDIO_FUNNEL_STAGE.VERIFICATION_PENDING,
    STUDIO_FUNNEL_STAGE.CONTRACT_PENDING,
    STUDIO_FUNNEL_STAGE.ONBOARDING_STARTED,
    STUDIO_FUNNEL_STAGE.ONBOARDING_INCOMPLETE,
    STUDIO_FUNNEL_STAGE.ACTIVE,
];

const CUSTOMER_DROPOFF = {
    REGISTERED_NO_STUDIO: 'registered_no_studio',
    STUDIO_NO_CASE_STARTED: 'studio_no_case_started',
    CASE_STARTED_NOT_CREATED: 'case_started_not_created',
    CASE_CREATED_NO_APPOINTMENT: 'case_created_no_appointment',
    APPOINTMENT_CANCELLED_NOT_REBOOKED: 'appointment_cancelled_not_rebooked',
};

const CUSTOMER_DROPOFFS = Object.values(CUSTOMER_DROPOFF);

const STUDIO_DROPOFF = {
    LEAD_STALLED: 'lead_stalled',
    VERIFICATION_STALLED: 'verification_stalled',
    CONTRACT_STALLED: 'contract_stalled',
    ONBOARDING_STALLED: 'onboarding_stalled',
};

const STUDIO_DROPOFFS = Object.values(STUDIO_DROPOFF);

const STUDIO_MISSING_STEP = {
    VERTRAG: 'vertrag',
    ZAHLUNG: 'zahlung',
    PROFILE: 'profile',
    VERIFICATION: 'verification',
};

const STUDIO_MISSING_STEPS = Object.values(STUDIO_MISSING_STEP);

const CUSTOMER_FUNNEL_ACTION = {
    [CUSTOMER_FUNNEL_STAGE.REGISTERED]: 'Select a studio',
    [CUSTOMER_FUNNEL_STAGE.STUDIO_SELECTED]: 'Start a case',
    [CUSTOMER_FUNNEL_STAGE.CASE_STARTED]: 'Complete case intake',
    [CUSTOMER_FUNNEL_STAGE.CASE_CREATED]: 'Book an appointment',
    [CUSTOMER_FUNNEL_STAGE.APPOINTMENT_BOOKED]: 'Attend first treatment',
    [CUSTOMER_FUNNEL_STAGE.FIRST_TREATMENT]: 'Continue treatment plan',
    [CUSTOMER_FUNNEL_STAGE.TREATMENT_ACTIVE]: 'Schedule next session',
    [CUSTOMER_FUNNEL_STAGE.COMPLETED]: 'Closed — optional follow-up',
};

const STUDIO_FUNNEL_ACTION = {
    [STUDIO_FUNNEL_STAGE.LEAD]: 'Contact lead / schedule demo',
    [STUDIO_FUNNEL_STAGE.REGISTRATION_STARTED]: 'Complete registration',
    [STUDIO_FUNNEL_STAGE.REGISTRATION_COMPLETED]: 'Submit for verification',
    [STUDIO_FUNNEL_STAGE.VERIFICATION_PENDING]: 'Review & verify studio',
    [STUDIO_FUNNEL_STAGE.CONTRACT_PENDING]: 'Send / chase contract',
    [STUDIO_FUNNEL_STAGE.ONBOARDING_STARTED]: 'Complete onboarding checklist',
    [STUDIO_FUNNEL_STAGE.ONBOARDING_INCOMPLETE]: 'Finish missing onboarding steps',
    [STUDIO_FUNNEL_STAGE.ACTIVE]: 'Studio active',
};

const customerFunnelStageIndex = (stage) => {
    const i = CUSTOMER_FUNNEL_STAGE_ORDER.indexOf(stage);
    return i >= 0 ? i : -1;
};

const studioFunnelStageIndex = (stage) => {
    const i = STUDIO_FUNNEL_STAGE_ORDER.indexOf(stage);
    return i >= 0 ? i : -1;
};

/** Furthest of two customer stages by funnel order. */
const maxCustomerFunnelStage = (a, b) => {
    if (!a) return b || CUSTOMER_FUNNEL_STAGE.REGISTERED;
    if (!b) return a;
    return customerFunnelStageIndex(a) >= customerFunnelStageIndex(b) ? a : b;
};

const isCustomerFunnelStage = (value) =>
    CUSTOMER_FUNNEL_STAGE_ORDER.includes(value);

const isStudioFunnelStage = (value) => STUDIO_FUNNEL_STAGE_ORDER.includes(value);

const isCustomerDropoff = (value) => CUSTOMER_DROPOFFS.includes(value);

const isStudioDropoff = (value) => STUDIO_DROPOFFS.includes(value);

const isPlatformCrmSubjectType = (value) =>
    PLATFORM_CRM_SUBJECT_TYPES.includes(value);

module.exports = {
    PLATFORM_CRM_STUCK_DAYS,
    PLATFORM_CRM_SUBJECT_TYPE,
    PLATFORM_CRM_SUBJECT_TYPES,
    CUSTOMER_FUNNEL_STAGE,
    CUSTOMER_FUNNEL_STAGE_ORDER,
    STUDIO_FUNNEL_STAGE,
    STUDIO_FUNNEL_STAGE_ORDER,
    CUSTOMER_DROPOFF,
    CUSTOMER_DROPOFFS,
    STUDIO_DROPOFF,
    STUDIO_DROPOFFS,
    STUDIO_MISSING_STEP,
    STUDIO_MISSING_STEPS,
    CUSTOMER_FUNNEL_ACTION,
    STUDIO_FUNNEL_ACTION,
    // Re-export shared CRM enums so platform models can import from one place
    PLATFORM_CRM_TASK_TYP: CRM_TASK_TYP,
    PLATFORM_CRM_TASK_PRIORITAET: CRM_TASK_PRIORITAET,
    PLATFORM_CRM_NOTE_TYP: CRM_NOTE_TYP,
    customerFunnelStageIndex,
    studioFunnelStageIndex,
    maxCustomerFunnelStage,
    isCustomerFunnelStage,
    isStudioFunnelStage,
    isCustomerDropoff,
    isStudioDropoff,
    isPlatformCrmSubjectType,
};

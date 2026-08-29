/** Prototype-aligned enums for tattoo case intake (customer app + studio dashboard). */

const BODY_LOCATIONS = [
    'arm',
    'leg',
    'chest',
    'back',
    'shoulder',
    'neck',
    'face',
    'abdomen',
    'hip',
    'hand',
    'foot',
    'other',
];

const BODY_LOCATION_LABELS = {
    arm: 'Arm',
    leg: 'Bein',
    chest: 'Brust',
    back: 'Rücken',
    shoulder: 'Schulter',
    neck: 'Hals',
    face: 'Gesicht',
    abdomen: 'Bauch',
    hip: 'Hüfte',
    hand: 'Hand',
    foot: 'Fuss',
    other: 'Andere',
};

const TC_SIDE = ['left', 'right', 'center'];

const TC_AGE_BUCKET = [
    'under_1',
    'age_1_3',
    'age_4_7',
    'age_8_15',
    'over_15',
    'unknown',
];

const TC_AGE_BUCKET_TO_MULT_KEY = {
    under_1: 'age_under1',
    age_1_3: 'age_1to3',
    age_4_7: 'age_3to5',
    age_8_15: 'age_5to10',
    over_15: 'age_over10',
    unknown: 'age_5to10',
};

const INK_COLOR_IDS = [
    'black',
    'grey',
    'red',
    'orange',
    'yellow',
    'green',
    'blue',
    'purple',
    'white',
    'skin_tone',
];

const QUALITY_LEVEL = ['low', 'medium', 'high', 'very_high'];
const SHADING_LEVEL = ['none', 'low', 'medium', 'high'];
const LINEWORK_LEVEL = ['fine', 'medium', 'bold', 'mixed'];
const RISK_LEVEL = ['low', 'medium', 'high', 'unsure'];
const SUN_EXPOSURE = ['low', 'medium', 'high'];

const SKIN_FITZPATRICK_TYPE = ['I', 'II', 'III', 'IV', 'V', 'VI', 'unsicher'];

const FITZ_TYPE_TO_INT = {
    I: 1,
    II: 2,
    III: 3,
    IV: 4,
    V: 5,
    VI: 6,
    unsicher: 3,
};

/** Tattoo + PMU smoker values (prototype PMU uses never/occasional). */
const LIFE_SMOKER = [
    'no',
    'never',
    'occasionally',
    'occasional',
    'daily_light',
    'daily_heavy',
];
/** Tattoo + PMU alcohol values (prototype PMU uses moderate/frequent). */
const LIFE_ALCOHOL = [
    'never',
    'rarely',
    'moderate',
    'frequent',
    '1-2x_week',
    '3-4x_week',
    '5+x_week',
];
/** Tattoo + PMU activity (prototype PMU uses medium). */
const LIFE_ACTIVITY = ['low', 'light', 'medium', 'regular', 'high'];
/** Lifestyle_Regeneration: 0|1-2|3-4|5+ */
const LIFE_SPORT_FREQ = ['0', '1-2', '3-4', '5+'];
/** Excel options include <5; app stores under_5. */
const LIFE_SLEEP_HOURS = ['under_5', '<5', '5-6', '6-7', '7-8', '8+'];
const LIFE_SLEEP_QUALITY = ['poor', 'fair', 'good', 'excellent'];
const LIFE_STRESS = ['low', 'medium', 'high', 'very_high'];
/** Tattoo + PMU hydration (prototype PMU uses medium/high). */
const LIFE_HYDRATION = ['low', 'normal', 'medium', 'good', 'high'];
const LIFE_NUTRITION = ['poor', 'fair', 'good', 'very_good', 'very_poor'];
const LIFE_AFTERCARE = ['low', 'medium', 'high'];

/** Prototype PMU_01–PMU_05 enums (exact values from customer/studio prototype). */
const PMU_TYPE = ['eyebrows', 'eyeliner', 'lips', 'microblading', 'other'];
const PMU_TYPE_LABELS = {
    eyebrows: 'Augenbrauen',
    eyeliner: 'Eyeliner',
    lips: 'Lippen',
    microblading: 'Microblading',
    other: 'PMU',
};
const PMU_SIDE = ['left', 'right', 'both'];
const PMU_AGE_RANGE = ['<1', '1-3', '4-7', '8-15', '>15', 'unknown'];
const PMU_TECHNIQUE = ['professional', 'amateur', 'cosmetic'];
const PMU_PIGMENT_TYPE = ['organic', 'inorganic', 'unknown'];
const PMU_STITCH_DEPTH = ['surface', 'medium', 'deep'];
const PMU_COLOR_LABELS = ['Schwarz', 'Braun', 'Grau', 'Beige', 'Rotbraun', 'Andere'];
const PMU_COLOR_DENSITY = ['light', 'medium', 'intense'];
const PMU_COLOR_SATURATION = ['faded', 'normal', 'saturated'];

module.exports = {
    BODY_LOCATIONS,
    BODY_LOCATION_LABELS,
    TC_SIDE,
    TC_AGE_BUCKET,
    TC_AGE_BUCKET_TO_MULT_KEY,
    INK_COLOR_IDS,
    QUALITY_LEVEL,
    SHADING_LEVEL,
    LINEWORK_LEVEL,
    RISK_LEVEL,
    SUN_EXPOSURE,
    SKIN_FITZPATRICK_TYPE,
    FITZ_TYPE_TO_INT,
    LIFE_SMOKER,
    LIFE_ALCOHOL,
    LIFE_ACTIVITY,
    LIFE_SPORT_FREQ,
    LIFE_SLEEP_HOURS,
    LIFE_SLEEP_QUALITY,
    LIFE_STRESS,
    LIFE_HYDRATION,
    LIFE_NUTRITION,
    LIFE_AFTERCARE,
    PMU_TYPE,
    PMU_TYPE_LABELS,
    PMU_SIDE,
    PMU_AGE_RANGE,
    PMU_TECHNIQUE,
    PMU_PIGMENT_TYPE,
    PMU_STITCH_DEPTH,
    PMU_COLOR_LABELS,
    PMU_COLOR_DENSITY,
    PMU_COLOR_SATURATION,
};

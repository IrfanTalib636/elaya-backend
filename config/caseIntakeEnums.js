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

const LIFE_SMOKER = ['no', 'occasionally', 'daily_light', 'daily_heavy'];
const LIFE_ALCOHOL = ['never', 'rarely', '1-2x_week', '3-4x_week', '5+x_week'];
const LIFE_ACTIVITY = ['low', 'light', 'regular', 'high'];
const LIFE_SLEEP_HOURS = ['under_5', '5-6', '6-7', '7-8', '8+'];
const LIFE_SLEEP_QUALITY = ['poor', 'fair', 'good', 'excellent'];
const LIFE_STRESS = ['low', 'medium', 'high', 'very_high'];
const LIFE_HYDRATION = ['low', 'normal', 'good'];
const LIFE_NUTRITION = ['poor', 'fair', 'good'];

const ZONE_FLAECHE_TEMPLATE = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl'];

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
    LIFE_SLEEP_HOURS,
    LIFE_SLEEP_QUALITY,
    LIFE_STRESS,
    LIFE_HYDRATION,
    LIFE_NUTRITION,
    ZONE_FLAECHE_TEMPLATE,
};

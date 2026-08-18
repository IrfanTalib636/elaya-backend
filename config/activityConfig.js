const ACTIVITY_CATEGORY = {
    BOOKINGS: 'bookings',
    CANCELLATIONS: 'cancellations',
    RESCHEDULES: 'reschedules',
    NO_SHOWS: 'no_shows',
    LOCKOUTS: 'lockouts',
    MEDICAL: 'medical',
    PROFILE: 'profile',
    STUDIO: 'studio',
    PRICES: 'prices',
    SESSIONS: 'sessions',
    OTHER: 'other',
};

const ACTIVITY_CATEGORIES = Object.values(ACTIVITY_CATEGORY);

const ACTIVITY_ACTOR_ROLE = {
    CUSTOMER: 'customer',
    STUDIO: 'studio',
    ADMIN: 'admin',
    SYSTEM: 'system',
};

/** Maps Case.activityLog.type → feed category (null = skip, covered elsewhere). */
const CASE_ACTIVITY_TYPE_MAP = {
    booked: null,
    cancelled: null,
    rescheduled: {
        category: ACTIVITY_CATEGORY.RESCHEDULES,
        tag: 'NEU ANGESETZT',
        type: 'rescheduled',
    },
    estimate_confirmation: {
        category: ACTIVITY_CATEGORY.PRICES,
        tag: 'PREIS',
        type: 'price_change',
    },
    klaerung_update: {
        category: ACTIVITY_CATEGORY.MEDICAL,
        tag: 'MEDIZIN',
        type: 'medical_change',
    },
    freigabe_update: {
        category: ACTIVITY_CATEGORY.STUDIO,
        tag: 'STUDIO',
        type: 'studio_action',
    },
    status_geaendert: {
        category: ACTIVITY_CATEGORY.MEDICAL,
        tag: 'STATUS',
        type: 'status_change',
    },
    rueckfrage_beantwortet: {
        category: ACTIVITY_CATEGORY.MEDICAL,
        tag: 'MEDIZIN',
        type: 'quick_check',
    },
    lockout: {
        category: ACTIVITY_CATEGORY.LOCKOUTS,
        tag: 'SPERRFRIST',
        type: 'lockout',
    },
};

const TAG_FOR_CATEGORY = {
    [ACTIVITY_CATEGORY.BOOKINGS]: 'BUCHUNG',
    [ACTIVITY_CATEGORY.CANCELLATIONS]: 'STORNIERUNG',
    [ACTIVITY_CATEGORY.RESCHEDULES]: 'NEU ANGESETZT',
    [ACTIVITY_CATEGORY.NO_SHOWS]: 'NICHT ERSCHIENEN',
    [ACTIVITY_CATEGORY.LOCKOUTS]: 'SPERRFRIST',
    [ACTIVITY_CATEGORY.MEDICAL]: 'MEDIZIN',
    [ACTIVITY_CATEGORY.PROFILE]: 'PROFIL',
    [ACTIVITY_CATEGORY.STUDIO]: 'STUDIO',
    [ACTIVITY_CATEGORY.PRICES]: 'PREIS',
    [ACTIVITY_CATEGORY.SESSIONS]: 'SITZUNG',
    [ACTIVITY_CATEGORY.OTHER]: 'SONSTIGES',
};

module.exports = {
    ACTIVITY_CATEGORY,
    ACTIVITY_CATEGORIES,
    ACTIVITY_ACTOR_ROLE,
    CASE_ACTIVITY_TYPE_MAP,
    TAG_FOR_CATEGORY,
};

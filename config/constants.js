const USER_ROLES = {
    CUSTOMER: 'customer',
    STUDIO_STAFF: 'studio_staff',
    STUDIO_ADMIN: 'studio_admin',
    ADMIN: 'admin',
    SUPER_ADMIN: 'super_admin',
    DEVELOPER: 'developer',
};

const USER_STATUS = {
    AUSSTEHEND: 'ausstehend',
    AKTIV: 'aktiv',
    GESPERRT: 'gesperrt',
};

const STUDIO_STATUS = {
    AUSSTEHEND: 'ausstehend',
    AKTIV: 'aktiv',
    GESPERRT: 'gesperrt',
};

const AKQUISE_QUELLE = {
    STUDIO_EIGEN: 'studio_eigen',
    PLATTFORM_VERMITTELT: 'plattform_vermittelt',
    STUDIO_WECHSEL: 'studio_wechsel',
};

const PIPELINE_STUFE = {
    NEU: 'Neu',
    BERATUNG_GEPLANT: 'Beratung geplant',
    BEHANDLUNG_AKTIV: 'Behandlung aktiv',
    BERATUNG_ERLEDIGT: 'Beratung erledigt',
};

const CASE_TYPE = {
    TATTOO: 'tattoo',
    PMU: 'pmu',
};

const CASE_STATUS = {
    PENDING: 'pending',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    LOESCHANTRAG_AUSSTEHEND: 'loeschantrag_ausstehend',
};

const TC_TYPE = {
    AMATEUR: 'amateur',
    COSMETIC: 'cosmetic',
    PROFESSIONAL: 'professional',
    COVERUP: 'coverup',
};

const TC_COVERUP = {
    NONE: 'none',
    ONCE: 'once',
    MULTIPLE: 'multiple',
};

const GOAL_TARGET = {
    FULL: 'full',
    PARTIAL_FADE: 'partial_fade',
    LIGHTENING_FOR_COVERUP: 'lightening_for_coverup',
};

const APPOINTMENT_STATUS = {
    GEBUCHT: 'gebucht',
    STORNIERT: 'storniert',
    CANCELLED: 'cancelled',
    COMPLETED: 'completed',
};

const APPOINTMENT_TYPE = {
    BERATUNG: 'beratung',
    TREATMENT: 'treatment',
    FIRST: 'first',
};

const PAYMENT_CURRENCY = {
    CHF: 'CHF',
    EUR: 'EUR',
};

const PAYMENT_METHOD = {
    BAR: 'bar',
    KARTE: 'karte',
    TWINT: 'twint',
};

const SHOP_ORDER_STATUS = {
    BESTELLT: 'bestellt',
    VERSENDET: 'versendet',
    GELIEFERT: 'geliefert',
};

module.exports = {
    USER_ROLES,
    USER_STATUS,
    STUDIO_STATUS,
    AKQUISE_QUELLE,
    PIPELINE_STUFE,
    CASE_TYPE,
    CASE_STATUS,
    TC_TYPE,
    TC_COVERUP,
    GOAL_TARGET,
    APPOINTMENT_STATUS,
    APPOINTMENT_TYPE,
    PAYMENT_CURRENCY,
    PAYMENT_METHOD,
    SHOP_ORDER_STATUS,
};

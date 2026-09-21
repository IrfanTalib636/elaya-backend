/**
 * Platform-wide defaults — maps prototype `elaya_admin_config` → production `platform_config` (client §2).
 */
const { DEFAULT_ELAYCOIN_REGELN } = require('./elaycoinConfig');
const { DEFAULT_AUTOMATISIERUNGEN } = require('./automationsDefaults');
const {
    defaultSubscriptionPackages,
    DEFAULT_KI_GEWICHTUNGEN,
} = require('./subscriptionPackages');

const PLATFORM_CONFIG_DEFAULTS = {
    /** CHF per coin — kept in sync with elaycoin_regeln (100 coins = CHF 5 → 0.05). */
    coinWert: 0.05,
    minWert: 0.05,
    maxWert: 0.2,
    deckelProzent: 20,
    verfallMonate: 12,
    /**
     * Prototype Elaycoin-Regeln — platform-wide engine rules + action catalog.
     * Studios may view; only Super Admin edits.
     */
    elaycoin_regeln: JSON.parse(JSON.stringify(DEFAULT_ELAYCOIN_REGELN)),
    /**
     * Prototype Automatisierungen — automatic customer message rules catalog.
     * Admin full CRUD; studios may only toggle aktiv + tage when editierbar_studio.
     */
    automatisierungen: JSON.parse(JSON.stringify(DEFAULT_AUTOMATISIERUNGEN)),
    grundgebuehr: 149,
    transaktionsProzent: 3,
    zahlungszielTage: 30,
    /** Studio commission % on ElayShop warenwert (remaining goes to Elaya). */
    shop_provision_prozent: 20,
    /** Editable ElayShop category list (prototype parity). */
    shop_categories: ['Nachsorge', 'Sonnenschutz', 'Reinigung', 'Zubehör', 'Sonstiges'],
    /** Editable shipping rates CHF by country + free thresholds. */
    shop_shipping: {
        Schweiz: 6.9,
        Deutschland: 12.9,
        Österreich: 12.9,
        Frankreich: 14.9,
        Italien: 14.9,
        'Andere EU': 16.9,
        gratis_ab_ch: 75,
        gratis_ab_eu: 150,
    },
    gruppen_groessen: {
        klein_max_cm2: 50,
        mittelgross_max_cm2: 150,
        max_punkte: 4,
        gruppen_rabatt: 0.15,
    },
    /**
     * Blocking periods (Sperrfristen) in days — platform / super-admin only.
     * Studios see effective values but cannot change them.
     */
    sperrfristen: {
        same_case_tage: 49,
        cross_case_tage: 28,
        uv_mittel_tage: 21,
        uv_intensiv_tage: 28,
        medikament_kurz_tage: 14,
        medikament_retinoide_tage: 180,
        condition_locks: {
            antidepressants: 'MEDICAL_CLEARANCE_REQUIRED',
            skin_acne_medication: 'MEDICAL_CLEARANCE_REQUIRED',
            other_unknown_medication: 'MEDICAL_REVIEW_REQUIRED',
            illness_not_recovered: 'MEDICAL_REVIEW_REQUIRED',
        },
        studio_exceptions: {},
    },
    /**
     * Appointment defaults the studio controls. Durations fall back to the
     * studio's slot interval when set to 0.
     */
    termin_einstellungen: {
        behandlung_dauer_minuten: 30,
        beratung_dauer_minuten: 30,
        gruppen_dauer_minuten: 90,
        /** How far ahead customers may book. */
        buchung_horizont_tage: 365,
        /** Earliest booking measured from now, so same-day walk-ins can be excluded. */
        min_vorlaufzeit_stunden: 0,
    },
    /**
     * Subscription packages → feature keys enabled by default.
     * Studio can have per-feature overrides (force on/off).
     */
    subscription_plans: {
        basic: ['booking', 'cases', 'elaycoins', 'anamnesis'],
        professional: [
            'booking',
            'cases',
            'elaycoins',
            'anamnesis',
            'elayshop',
            'group_booking',
            'crm',
            'analytics',
            'messaging',
        ],
        enterprise: [
            'booking',
            'cases',
            'elaycoins',
            'anamnesis',
            'elayshop',
            'group_booking',
            'crm',
            'analytics',
            'messaging',
            'ai_nachsorge',
            'ai_chat',
            'ai_verblassung',
            'studio_transfer',
        ],
    },
    /**
     * Max active ELAYA logins per subscription plan.
     * null / missing = unlimited. Staff profiles stay unlimited separately.
     * Maps: basic≈small(2), professional≈medium(4), enterprise≈large(unlimited).
     */
    subscription_seat_limits: {
        basic: 2,
        professional: 4,
        enterprise: null,
    },
    /**
     * Editable Elaya packages (prototype Pakete & Features).
     * Canonical ids starter/pro/network map to subscription_plan basic/professional/enterprise.
     */
    subscription_packages: defaultSubscriptionPackages(),
    /** Units consumed per KI feature use (soft overage against package kontingent). */
    ki_gewichtungen: { ...DEFAULT_KI_GEWICHTUNGEN },
};

/**
 * Treatment load per size category, in points.
 *
 * Platform-wide and deliberately not studio-editable: the "a large tattoo must
 * be booked alone" rule is a consequence of `gross` equalling the default point
 * cap, so letting studios retune these would silently change that guarantee.
 * Exposed through the config API so clients can label the categories instead of
 * repeating the numbers.
 */
const GRUPPEN_PUNKTE = {
    klein: 1,
    mittelgross: 2,
    gross: 4,
};

/** Keys managed at platform level — not editable per studio via studio_pricing */
const PLATFORM_GROUP_KEYS = [
    'gruppen_rabatt',
    'klein_max_cm2',
    'mittelgross_max_cm2',
    'max_punkte',
];

/**
 * Numeric settings blocks that follow the same three-layer merge:
 * static defaults → platform config → studio override.
 */
const NUMERIC_CONFIG_BLOCKS = ['gruppen_groessen', 'sperrfristen', 'termin_einstellungen'];

/**
 * Blocks a studio may override through its own dashboard.
 * Medical lockouts (`sperrfristen`) are platform / super-admin only.
 */
const STUDIO_OVERRIDABLE_BLOCKS = ['gruppen_groessen', 'termin_einstellungen'];

/** Blocks only super_admin may write (platform defaults or per-studio override). */
const SUPER_ADMIN_ONLY_CONFIG_BLOCKS = ['sperrfristen'];

const blockKeys = (block) => Object.keys(PLATFORM_CONFIG_DEFAULTS[block]);

module.exports = {
    PLATFORM_CONFIG_DEFAULTS,
    GRUPPEN_PUNKTE,
    PLATFORM_GROUP_KEYS,
    NUMERIC_CONFIG_BLOCKS,
    STUDIO_OVERRIDABLE_BLOCKS,
    SUPER_ADMIN_ONLY_CONFIG_BLOCKS,
    blockKeys,
};

/**
 * Platform-wide defaults — maps prototype `elaya_admin_config` → production `platform_config` (client §2).
 */
const PLATFORM_CONFIG_DEFAULTS = {
    coinWert: 0.1,
    minWert: 0.05,
    maxWert: 0.2,
    deckelProzent: 20,
    verfallMonate: 12,
    grundgebuehr: 149,
    transaktionsProzent: 3,
    zahlungszielTage: 30,
    /** Studio commission % on ElayShop warenwert (remaining goes to Elaya). */
    shop_provision_prozent: 20,
    gruppen_groessen: {
        klein_max_cm2: 50,
        mittelgross_max_cm2: 150,
        max_punkte: 4,
        gruppen_rabatt: 0.15,
    },
    /**
     * Blocking periods (Sperrfristen) in days. Every value is overridable per
     * studio, so medical wait times never require a code change.
     */
    sperrfristen: {
        same_case_tage: 49,
        cross_case_tage: 28,
        uv_mittel_tage: 21,
        uv_intensiv_tage: 28,
        medikament_kurz_tage: 14,
        medikament_retinoide_tage: 180,
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

/** Blocks a studio may override through its own dashboard. */
const STUDIO_OVERRIDABLE_BLOCKS = ['gruppen_groessen', 'sperrfristen', 'termin_einstellungen'];

const blockKeys = (block) => Object.keys(PLATFORM_CONFIG_DEFAULTS[block]);

module.exports = {
    PLATFORM_CONFIG_DEFAULTS,
    GRUPPEN_PUNKTE,
    PLATFORM_GROUP_KEYS,
    NUMERIC_CONFIG_BLOCKS,
    STUDIO_OVERRIDABLE_BLOCKS,
    blockKeys,
};

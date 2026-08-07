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

/** Keys managed at platform level — not editable per studio via studio_pricing */
const PLATFORM_GROUP_KEYS = [
    'gruppen_rabatt',
    'klein_max_cm2',
    'mittelgross_max_cm2',
    'max_punkte',
];

module.exports = {
    PLATFORM_CONFIG_DEFAULTS,
    PLATFORM_GROUP_KEYS,
};

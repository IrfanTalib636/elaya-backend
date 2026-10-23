const { DEFAULT_ELAYCOIN_REGELN } = require('./elaycoinConfig');
const { DEFAULT_AUTOMATISIERUNGEN } = require('./automationsDefaults');
const {
    defaultSubscriptionPackages,
    DEFAULT_KI_GEWICHTUNGEN,
} = require('./subscriptionPackages');

const PLATFORM_CONFIG_DEFAULTS = {
    coinWert: 0.05,
    minWert: 0.05,
    maxWert: 0.2,
    deckelProzent: 20,
    verfallMonate: 12,
   
    elaycoin_regeln: JSON.parse(JSON.stringify(DEFAULT_ELAYCOIN_REGELN)),
   
    automatisierungen: JSON.parse(JSON.stringify(DEFAULT_AUTOMATISIERUNGEN)),
    grundgebuehr: 149,
    transaktionsProzent: 3,
    zahlungszielTage: 30,
    shop_provision_prozent: 20,
    shop_categories: ['Nachsorge', 'Sonnenschutz', 'Reinigung', 'Zubehör', 'Sonstiges'],
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
    
    sperrfristen: {
        same_case_tage: 49,
        cross_case_tage: 28,
        uv_mittel_tage: 21,
        uv_intensiv_tage: 28,
        medikament_kurz_tage: 14,
        medikament_retinoide_tage: 180,
        condition_locks: {
            antidepressants: 'MEDICAL_CLEARANCE_REQUIRED',
           
            antibiotics: 'DATE_LOCK_CLEARANCE_OVERRIDE',
            skin_acne_medication: 'DATE_LOCK_CLEARANCE_OVERRIDE',
            other_unknown_medication: 'MEDICAL_REVIEW_REQUIRED',
            illness_not_recovered: 'MEDICAL_REVIEW_REQUIRED',
        },
        studio_exceptions: {},
    },
    
    termin_einstellungen: {
        behandlung_dauer_minuten: 30,
        beratung_dauer_minuten: 30,
        gruppen_dauer_minuten: 90,
        buchung_horizont_tage: 365,
        min_vorlaufzeit_stunden: 0,
    },
    
    subscription_plans: {
        basic: [
            'case_basic',
            'case_zonen',
            'terminbuchung',
            'sitzungsprotokoll',
            'anamnese',
            'unterschrift',
            'tattoocase_simulator',
            'ki_nachsorge',
            'ki_verblassung',
            'ki_studio_assistent',
            'online_buchung',
            'plattform_gebuehren',
            'elaya_chat_kunde',
            'chat_studio_kunde',
            'studio_chat',
            'elaycoins_basic',
            'elayshop',
            'multi_mitarbeiter',
        ],
        professional: [
            'case_basic',
            'case_zonen',
            'terminbuchung',
            'sitzungsprotokoll',
            'anamnese',
            'unterschrift',
            'tattoocase_simulator',
            'ki_nachsorge',
            'ki_verblassung',
            'ki_studio_assistent',
            'online_buchung',
            'plattform_gebuehren',
            'elaya_chat_kunde',
            'chat_studio_kunde',
            'studio_chat',
            'elaycoins_basic',
            'elayshop',
            'multi_mitarbeiter',
            'gruppen_buchung',
            'analytics',
            'crm_leads',
            'export_rechte',
            'automatisierungen',
            'elaycoins_erweitert',
            'studio_wechsel',
            'gruppen_rabatt',
            'shop_provision',
        ],
        enterprise: [
            'case_basic',
            'case_zonen',
            'terminbuchung',
            'sitzungsprotokoll',
            'anamnese',
            'unterschrift',
            'tattoocase_simulator',
            'ki_nachsorge',
            'ki_verblassung',
            'ki_studio_assistent',
            'online_buchung',
            'plattform_gebuehren',
            'elaya_chat_kunde',
            'chat_studio_kunde',
            'studio_chat',
            'elaycoins_basic',
            'elayshop',
            'multi_mitarbeiter',
            'gruppen_buchung',
            'analytics',
            'crm_leads',
            'export_rechte',
            'automatisierungen',
            'elaycoins_erweitert',
            'studio_wechsel',
            'gruppen_rabatt',
            'shop_provision',
            'multi_location',
            'multi_raeume',
            'priority_support',
        ],
    },
   
    subscription_seat_limits: {
        basic: 2,
        professional: 4,
        enterprise: null,
    },
    
    subscription_packages: defaultSubscriptionPackages(),
    ki_gewichtungen: { ...DEFAULT_KI_GEWICHTUNGEN },
};

const GRUPPEN_PUNKTE = {
    klein: 1,
    mittelgross: 2,
    gross: 4,
};

const PLATFORM_GROUP_KEYS = [
    'gruppen_rabatt',
    'klein_max_cm2',
    'mittelgross_max_cm2',
    'max_punkte',
];

const NUMERIC_CONFIG_BLOCKS = ['gruppen_groessen', 'sperrfristen', 'termin_einstellungen'];

const STUDIO_OVERRIDABLE_BLOCKS = ['gruppen_groessen', 'termin_einstellungen'];

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

/**
 * Platform feature catalog — prototype parity (`ELAYA_ALLE_FEATURES`).
 * Toggled: package entitlements → per-studio overrides → global kill switch.
 *
 * Clients gate UX with GET /config/features/effective.
 * Backend enforces via requireFeature / isFeatureEnabled.
 */

/** @typedef {{ key: string, label: string, label_en?: string }} FeatureDef */
/** @typedef {{ gruppe: string, gruppe_en: string, icon: string, category: string, features: FeatureDef[] }} FeatureGroup */

/** Full catalog — 9 groups / 30 keys (inkderm-prototype admin Feature Flags). */
const FEATURE_GROUPS = [
    {
        gruppe: 'Core',
        gruppe_en: 'Core',
        icon: '📁',
        category: 'core',
        features: [
            { key: 'case_basic', label: 'Case-Erstellung (Standard)', label_en: 'Case creation (standard)' },
            { key: 'case_zonen', label: 'Case-Erstellung mit Zonen-System', label_en: 'Case creation with zone system' },
            { key: 'terminbuchung', label: 'Terminbuchung', label_en: 'Appointment booking' },
            { key: 'sitzungsprotokoll', label: 'Sitzungsprotokoll erfassen', label_en: 'Record session protocol' },
            { key: 'anamnese', label: 'Medizinische Anamnese', label_en: 'Medical anamnesis' },
            { key: 'unterschrift', label: 'Digitale Unterschrift', label_en: 'Digital signature' },
            { key: 'tattoocase_simulator', label: 'Tattoo Case Simulator', label_en: 'Tattoo case simulator' },
        ],
    },
    {
        gruppe: 'KI & Analyse',
        gruppe_en: 'AI & Analysis',
        icon: '🤖',
        category: 'ai',
        features: [
            { key: 'ki_nachsorge', label: 'Nachsorge KI (Kunden-App)', label_en: 'Aftercare AI (customer app)' },
            { key: 'ki_verblassung', label: 'KI Verblassungsanalyse', label_en: 'AI fading analysis' },
            { key: 'ki_studio_assistent', label: 'Studio KI-Assistent', label_en: 'Studio AI assistant' },
        ],
    },
    {
        gruppe: 'Buchung',
        gruppe_en: 'Booking',
        icon: '📅',
        category: 'booking',
        features: [
            { key: 'gruppen_buchung', label: 'Gruppen-Buchung', label_en: 'Group booking' },
            { key: 'online_buchung', label: 'Online-Buchung via Kunden-App', label_en: 'Online booking via customer app' },
        ],
    },
    {
        gruppe: 'Analytics & CRM',
        gruppe_en: 'Analytics & CRM',
        icon: '📈',
        category: 'analytics',
        features: [
            { key: 'analytics', label: 'Studio Analytics & Berichte', label_en: 'Studio analytics & reports' },
            { key: 'crm_leads', label: 'CRM & Leads Pipeline', label_en: 'CRM & leads pipeline' },
            { key: 'plattform_gebuehren', label: 'Abo & Rechnungen', label_en: 'Subscription & invoices' },
            {
                key: 'export_rechte',
                label: 'CSV-/PDF-Export von Kundendaten & Analytics',
                label_en: 'CSV/PDF export of customer data & analytics',
            },
        ],
    },
    {
        gruppe: 'Kommunikation',
        gruppe_en: 'Communication',
        icon: '💬',
        category: 'communication',
        features: [
            { key: 'elaya_chat_kunde', label: 'Elaya Chat (Kunden-App)', label_en: 'Elaya chat (customer app)' },
            { key: 'chat_studio_kunde', label: 'Chat Studio ↔ Kunde', label_en: 'Chat studio ↔ customer' },
            { key: 'automatisierungen', label: 'Automatisierungen', label_en: 'Automations' },
        ],
    },
    {
        gruppe: 'Kundenbindung',
        gruppe_en: 'Loyalty',
        icon: '🪙',
        category: 'engagement',
        features: [
            { key: 'elaycoins_basic', label: 'Elaycoins (Standard)', label_en: 'Elaycoins (standard)' },
            {
                key: 'elaycoins_erweitert',
                label: 'Elaycoins (Erweitert + Verfall)',
                label_en: 'Elaycoins (advanced + expiry)',
            },
            { key: 'studio_wechsel', label: 'Studio-Wechsel Funktion', label_en: 'Studio transfer' },
            { key: 'gruppen_rabatt', label: 'Gruppen-Rabatt System', label_en: 'Group discount system' },
        ],
    },
    {
        gruppe: 'Shop',
        gruppe_en: 'Shop',
        icon: '🛍️',
        category: 'commerce',
        features: [
            { key: 'elayshop', label: 'ElayShop (Kunden kaufen)', label_en: 'ElayShop (customer purchases)' },
            { key: 'shop_provision', label: 'Shop-Provision Verwaltung', label_en: 'Shop commission management' },
        ],
    },
    {
        gruppe: 'Multi-Location',
        gruppe_en: 'Multi-Location',
        icon: '🏢',
        category: 'multi',
        features: [
            { key: 'multi_location', label: 'Mehrere Standorte', label_en: 'Multiple locations' },
            { key: 'multi_mitarbeiter', label: 'Mehrere Mitarbeiter', label_en: 'Multiple employees' },
            { key: 'multi_raeume', label: 'Räume-Verwaltung', label_en: 'Room management' },
        ],
    },
    {
        gruppe: 'Support',
        gruppe_en: 'Support',
        icon: '🛟',
        category: 'support',
        features: [
            { key: 'studio_chat', label: 'Studio-Chat mit Admin', label_en: 'Studio chat with admin' },
            { key: 'priority_support', label: 'Priority Support', label_en: 'Priority support' },
        ],
    },
];

/** Flat catalog (backward-compatible shape for admin API). */
const FEATURE_CATALOG = FEATURE_GROUPS.flatMap((g) =>
    g.features.map((f) => ({
        key: f.key,
        label: f.label,
        label_en: f.label_en || f.label,
        category: g.category,
        gruppe: g.gruppe,
        gruppe_en: g.gruppe_en,
        icon: g.icon,
    }))
);

const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key);

/**
 * Legacy Elaya keys → canonical prototype keys.
 * `ai_chat` expands to both customer Elaya chat and studio KI (see migrateFeatureKeyList).
 */
const LEGACY_FEATURE_ALIASES = {
    booking: 'terminbuchung',
    cases: 'case_basic',
    anamnesis: 'anamnese',
    elaycoins: 'elaycoins_basic',
    group_booking: 'gruppen_buchung',
    crm: 'crm_leads',
    messaging: 'chat_studio_kunde',
    ai_nachsorge: 'ki_nachsorge',
    ai_verblassung: 'ki_verblassung',
    ai_chat: 'elaya_chat_kunde',
    studio_transfer: 'studio_wechsel',
};

/** When legacy `ai_chat` was enabled, also enable studio KI assistant. */
const LEGACY_AI_CHAT_EXPANSION = ['elaya_chat_kunde', 'ki_studio_assistent'];

/**
 * Reverse map: canonical → list of legacy keys that should mirror its value
 * in effective-feature responses (old clients keep working).
 */
const CANONICAL_TO_LEGACY = (() => {
    const map = {};
    for (const [legacy, canonical] of Object.entries(LEGACY_FEATURE_ALIASES)) {
        if (!map[canonical]) map[canonical] = [];
        map[canonical].push(legacy);
    }
    return map;
})();

const resolveCanonicalKey = (key) => {
    if (!key) return key;
    if (FEATURE_KEYS.includes(key)) return key;
    return LEGACY_FEATURE_ALIASES[key] || key;
};

/**
 * Migrate a stored feature-key list (packages / plans / overrides keys) to canonical keys.
 * Drops unknown keys; expands legacy ai_chat → both chat flags.
 */
const migrateFeatureKeyList = (list) => {
    if (!Array.isArray(list)) return [];
    const out = new Set();
    for (const raw of list) {
        const k = String(raw || '').trim();
        if (!k) continue;
        if (k === 'ai_chat') {
            LEGACY_AI_CHAT_EXPANSION.forEach((x) => out.add(x));
            continue;
        }
        const canonical = resolveCanonicalKey(k);
        if (FEATURE_KEYS.includes(canonical)) out.add(canonical);
    }
    return [...out];
};

/**
 * Migrate a feature_overrides / feature_global object’s keys to canonical.
 * Conflicting values: explicit false wins over true when merging aliases.
 */
const migrateFeatureMap = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [rawKey, val] of Object.entries(obj)) {
        if (typeof val !== 'boolean') continue;
        if (rawKey === 'ai_chat') {
            for (const k of LEGACY_AI_CHAT_EXPANSION) {
                if (out[k] === false) continue;
                out[k] = val;
            }
            continue;
        }
        const canonical = resolveCanonicalKey(rawKey);
        if (!FEATURE_KEYS.includes(canonical)) continue;
        if (out[canonical] === false) continue;
        if (val === false) out[canonical] = false;
        else if (out[canonical] !== false) out[canonical] = true;
    }
    return out;
};

const SUBSCRIPTION_PLAN_KEYS = ['basic', 'professional', 'enterprise'];

module.exports = {
    FEATURE_GROUPS,
    FEATURE_CATALOG,
    FEATURE_KEYS,
    LEGACY_FEATURE_ALIASES,
    LEGACY_AI_CHAT_EXPANSION,
    CANONICAL_TO_LEGACY,
    resolveCanonicalKey,
    migrateFeatureKeyList,
    migrateFeatureMap,
    SUBSCRIPTION_PLAN_KEYS,
};

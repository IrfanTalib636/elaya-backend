/**
 * Subscription packages (prototype Starter / Pro / Network).
 * Mapped onto existing studio.subscription_plan: basic | professional | enterprise.
 *
 * Reines Abo-Modell:
 * - Monthly abo fee per studio (override > package)
 * - Shop: studio gets shop_provision_studio_prozent of Warenwert; Elaya gets the rest
 * - NO transaction fee on platform Erlös
 *
 * Editable copy lives on platform_config.subscription_packages; this file is the seed.
 */

const { FEATURE_KEYS } = require('./featureCatalog');

const PLAN_TO_PACKAGE = {
    basic: 'starter',
    professional: 'pro',
    enterprise: 'network',
};

const PACKAGE_TO_PLAN = {
    starter: 'basic',
    pro: 'professional',
    network: 'enterprise',
};

/** Prototype PAKET_LIMITS_DEFAULT */
const PACKAGE_LIMITS_DEFAULT = {
    starter: {
        mitarbeiter_max: 2,
        standorte_max: 1,
        standort_aufpreis_chf: 0,
        shop_provision_prozent: 10,
        ki_kontingent_monat: 50,
        datenaufbewahrung_monate: 12,
    },
    pro: {
        mitarbeiter_max: 4,
        standorte_max: 1,
        standort_aufpreis_chf: 0,
        shop_provision_prozent: 15,
        ki_kontingent_monat: 200,
        datenaufbewahrung_monate: 24,
    },
    network: {
        mitarbeiter_max: null,
        standorte_max: 2,
        standort_aufpreis_chf: 39,
        shop_provision_prozent: 20,
        ki_kontingent_monat: null,
        datenaufbewahrung_monate: null,
    },
};

const DEFAULT_KI_GEWICHTUNGEN = {
    nachsorge: 2,
    verblassung: 3,
    kundenchat: 1,
    studio_ki_chat: 1,
};

const STARTER_FEATURES = ['booking', 'cases', 'elaycoins', 'anamnesis'];
const PRO_EXTRA = ['elayshop', 'group_booking', 'crm', 'analytics', 'messaging'];
const NETWORK_FEATURES = [...FEATURE_KEYS];

const packageLimitsDefault = (id) => {
    const d = PACKAGE_LIMITS_DEFAULT[id] || {
        mitarbeiter_max: null,
        standorte_max: 1,
        standort_aufpreis_chf: 0,
        shop_provision_prozent: 20,
        ki_kontingent_monat: null,
        datenaufbewahrung_monate: null,
    };
    return { ...d };
};

const buildDefaultPackage = (id, extras = {}) => {
    const limits = packageLimitsDefault(id);
    const plan = PACKAGE_TO_PLAN[id] || 'basic';
    return {
        id,
        plan,
        name: extras.name || id,
        name_de: extras.name_de || extras.name || id,
        name_en: extras.name_en || extras.name || id,
        beschreibung: extras.beschreibung || '',
        preis_monat: extras.preis_monat ?? 0,
        limits: { ...limits },
        max_standorte: limits.standorte_max,
        max_mitarbeiter: limits.mitarbeiter_max,
        shop_provision_studio_prozent: limits.shop_provision_prozent,
        ki_kontingent_einheiten_monat: limits.ki_kontingent_monat,
        features: Array.isArray(extras.features) ? [...extras.features] : [],
    };
};

const defaultSubscriptionPackages = () => [
    buildDefaultPackage('starter', {
        name: 'Starter',
        name_de: 'Starter',
        name_en: 'Starter',
        preis_monat: 29,
        beschreibung: 'Einstiegspaket',
        features: STARTER_FEATURES.slice(),
    }),
    buildDefaultPackage('pro', {
        name: 'Pro',
        name_de: 'Pro',
        name_en: 'Pro',
        preis_monat: 49,
        beschreibung: 'Für wachsende Studios',
        features: STARTER_FEATURES.concat(PRO_EXTRA),
    }),
    buildDefaultPackage('network', {
        name: 'Network',
        name_de: 'Network',
        name_en: 'Network',
        preis_monat: 99,
        beschreibung: 'Alle Features freigeschaltet',
        features: NETWORK_FEATURES.slice(),
    }),
];

/** Legacy map shape used by older Finance callers */
const SUBSCRIPTION_PACKAGES = Object.fromEntries(
    defaultSubscriptionPackages().map((p) => [
        p.id,
        {
            id: p.id,
            plan: p.plan,
            name_de: p.name_de,
            name_en: p.name_en,
            preis_monat: p.preis_monat,
            shop_provision_studio_prozent: p.shop_provision_studio_prozent,
            ki_kontingent_monat: p.ki_kontingent_einheiten_monat,
        },
    ])
);

const optNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

const normalizePackage = (raw = {}) => {
    const id = String(raw.id || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'paket';
    const baseLimits = packageLimitsDefault(id);
    const limIn = raw.limits && typeof raw.limits === 'object' ? raw.limits : {};
    const limits = {
        mitarbeiter_max:
            limIn.mitarbeiter_max !== undefined
                ? optNum(limIn.mitarbeiter_max)
                : optNum(raw.max_mitarbeiter) ?? baseLimits.mitarbeiter_max,
        standorte_max:
            limIn.standorte_max !== undefined
                ? optNum(limIn.standorte_max)
                : optNum(raw.max_standorte) ?? baseLimits.standorte_max,
        standort_aufpreis_chf:
            limIn.standort_aufpreis_chf !== undefined
                ? optNum(limIn.standort_aufpreis_chf) ?? 0
                : baseLimits.standort_aufpreis_chf,
        shop_provision_prozent:
            limIn.shop_provision_prozent !== undefined
                ? optNum(limIn.shop_provision_prozent)
                : optNum(raw.shop_provision_studio_prozent) ??
                  baseLimits.shop_provision_prozent,
        ki_kontingent_monat:
            limIn.ki_kontingent_monat !== undefined
                ? optNum(limIn.ki_kontingent_monat)
                : optNum(raw.ki_kontingent_einheiten_monat) ??
                  optNum(raw.ki_kontingent_monat) ??
                  baseLimits.ki_kontingent_monat,
        datenaufbewahrung_monate:
            limIn.datenaufbewahrung_monate !== undefined
                ? optNum(limIn.datenaufbewahrung_monate)
                : baseLimits.datenaufbewahrung_monate,
    };
    if (limits.shop_provision_prozent == null || limits.shop_provision_prozent < 0) {
        limits.shop_provision_prozent = baseLimits.shop_provision_prozent;
    }
    const features = Array.isArray(raw.features)
        ? raw.features.filter((k) => FEATURE_KEYS.includes(k))
        : [];
    const plan =
        PACKAGE_TO_PLAN[id] ||
        (['basic', 'professional', 'enterprise'].includes(raw.plan) ? raw.plan : 'basic');
    const name = String(raw.name || raw.name_de || raw.name_en || id).trim() || id;

    return {
        id,
        plan,
        name,
        name_de: String(raw.name_de || name).trim(),
        name_en: String(raw.name_en || name).trim(),
        beschreibung: String(raw.beschreibung || '').trim(),
        preis_monat: Math.max(0, Number(raw.preis_monat) || 0),
        limits,
        max_standorte: limits.standorte_max,
        max_mitarbeiter: limits.mitarbeiter_max,
        shop_provision_studio_prozent: limits.shop_provision_prozent,
        ki_kontingent_einheiten_monat: limits.ki_kontingent_monat,
        features,
    };
};

const normalizePackagesList = (list) => {
    if (!Array.isArray(list) || !list.length) {
        return defaultSubscriptionPackages();
    }
    const seen = new Set();
    const out = [];
    for (const raw of list) {
        const p = normalizePackage(raw);
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
    }
    return out.length ? out : defaultSubscriptionPackages();
};

const packagesByIdMap = (list) => {
    const arr = normalizePackagesList(list);
    return Object.fromEntries(arr.map((p) => [p.id, p]));
};

const packageIdFromPlan = (subscriptionPlan) =>
    PLAN_TO_PACKAGE[subscriptionPlan] || 'starter';

const packageById = (packageId, packagesList) => {
    const map = packagesByIdMap(packagesList || defaultSubscriptionPackages());
    return map[packageId] || map.starter || defaultSubscriptionPackages()[0];
};

const packageFromStudioPlan = (subscriptionPlan, packagesList) =>
    packageById(packageIdFromPlan(subscriptionPlan), packagesList);

const hasOverrideValue = (v) => v !== null && v !== undefined && v !== '';

/**
 * Effective monthly abo fee (CHF) and studio shop provision % for a studio doc.
 * @param {object} studio
 * @param {number} [fallbackPlatformProvision=20]
 * @param {object[]|object} [packagesSource] — platform packages array or by-id map
 */
const resolveStudioFinanceTerms = (
    studio = {},
    fallbackPlatformProvision = 20,
    packagesSource
) => {
    const list = Array.isArray(packagesSource)
        ? packagesSource
        : packagesSource && typeof packagesSource === 'object'
          ? Object.values(packagesSource)
          : null;
    const pkg = packageFromStudioPlan(studio.subscription_plan, list);
    const preis = hasOverrideValue(studio.preis_override)
        ? Number(studio.preis_override)
        : Number(pkg.preis_monat) || 0;
    const shopPct = hasOverrideValue(studio.shop_provision_override)
        ? Number(studio.shop_provision_override)
        : pkg.shop_provision_studio_prozent != null
          ? Number(pkg.shop_provision_studio_prozent)
          : Number(fallbackPlatformProvision) || 20;

    return {
        package_id: pkg.id,
        package_name: pkg.name_en || pkg.name,
        package_name_de: pkg.name_de || pkg.name,
        subscription_plan: studio.subscription_plan || pkg.plan,
        abo_chf: Math.round(preis * 100) / 100,
        shop_provision_studio_prozent: Math.round(shopPct * 100) / 100,
        has_override:
            hasOverrideValue(studio.preis_override) ||
            hasOverrideValue(studio.shop_provision_override),
        preis_override: hasOverrideValue(studio.preis_override)
            ? Number(studio.preis_override)
            : null,
        shop_provision_override: hasOverrideValue(studio.shop_provision_override)
            ? Number(studio.shop_provision_override)
            : null,
        override_grund: studio.override_grund || '',
        override_datum: studio.override_datum || null,
        ki_kontingent_monat:
            pkg.ki_kontingent_einheiten_monat ?? pkg.limits?.ki_kontingent_monat ?? null,
        limits: pkg.limits || packageLimitsDefault(pkg.id),
    };
};

/** Derive subscription_plans + seat limits from editable packages (canonical ids). */
const derivePlanConfigFromPackages = (packagesList) => {
    const list = normalizePackagesList(packagesList);
    const byId = packagesByIdMap(list);
    const subscription_plans = {
        basic: byId.starter?.features?.length
            ? [...byId.starter.features]
            : STARTER_FEATURES.slice(),
        professional: byId.pro?.features?.length
            ? [...byId.pro.features]
            : STARTER_FEATURES.concat(PRO_EXTRA),
        enterprise: byId.network?.features?.length
            ? [...byId.network.features]
            : NETWORK_FEATURES.slice(),
    };
    const subscription_seat_limits = {
        basic: byId.starter?.limits?.mitarbeiter_max ?? 2,
        professional: byId.pro?.limits?.mitarbeiter_max ?? 4,
        enterprise: byId.network?.limits?.mitarbeiter_max ?? null,
    };
    return { subscription_plans, subscription_seat_limits };
};

const normalizeKiGewichtungen = (raw = {}) => ({
    nachsorge: Math.max(0, Number(raw.nachsorge) || DEFAULT_KI_GEWICHTUNGEN.nachsorge),
    verblassung: Math.max(
        0,
        Number(raw.verblassung) || DEFAULT_KI_GEWICHTUNGEN.verblassung
    ),
    kundenchat: Math.max(0, Number(raw.kundenchat) || DEFAULT_KI_GEWICHTUNGEN.kundenchat),
    studio_ki_chat: Math.max(
        0,
        Number(raw.studio_ki_chat) || DEFAULT_KI_GEWICHTUNGEN.studio_ki_chat
    ),
});

module.exports = {
    SUBSCRIPTION_PACKAGES,
    PLAN_TO_PACKAGE,
    PACKAGE_TO_PLAN,
    PACKAGE_LIMITS_DEFAULT,
    DEFAULT_KI_GEWICHTUNGEN,
    packageLimitsDefault,
    defaultSubscriptionPackages,
    normalizePackage,
    normalizePackagesList,
    packagesByIdMap,
    packageIdFromPlan,
    packageById,
    packageFromStudioPlan,
    resolveStudioFinanceTerms,
    hasOverrideValue,
    derivePlanConfigFromPackages,
    normalizeKiGewichtungen,
};

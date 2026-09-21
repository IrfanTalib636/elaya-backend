/**
 * Subscription packages (prototype Starter / Pro / Network).
 * Mapped onto existing studio.subscription_plan: basic | professional | enterprise.
 *
 * Reines Abo-Modell:
 * - Monthly abo fee per studio (override > package)
 * - Shop: studio gets shop_provision_studio_prozent of Warenwert; Elaya gets the rest
 * - NO transaction fee on platform Erlös
 */

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

const SUBSCRIPTION_PACKAGES = {
    starter: {
        id: 'starter',
        plan: 'basic',
        name_de: 'Starter',
        name_en: 'Starter',
        preis_monat: 29,
        shop_provision_studio_prozent: 10,
        ki_kontingent_monat: 50,
    },
    pro: {
        id: 'pro',
        plan: 'professional',
        name_de: 'Pro',
        name_en: 'Pro',
        preis_monat: 49,
        shop_provision_studio_prozent: 15,
        ki_kontingent_monat: 200,
    },
    network: {
        id: 'network',
        plan: 'enterprise',
        name_de: 'Network',
        name_en: 'Network',
        preis_monat: 99,
        shop_provision_studio_prozent: 20,
        ki_kontingent_monat: null,
    },
};

const packageIdFromPlan = (subscriptionPlan) =>
    PLAN_TO_PACKAGE[subscriptionPlan] || 'starter';

const packageById = (packageId) =>
    SUBSCRIPTION_PACKAGES[packageId] || SUBSCRIPTION_PACKAGES.starter;

const packageFromStudioPlan = (subscriptionPlan) =>
    packageById(packageIdFromPlan(subscriptionPlan));

const hasOverrideValue = (v) => v !== null && v !== undefined && v !== '';

/**
 * Effective monthly abo fee (CHF) and studio shop provision % for a studio doc.
 */
const resolveStudioFinanceTerms = (studio = {}, fallbackPlatformProvision = 20) => {
    const pkg = packageFromStudioPlan(studio.subscription_plan);
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
        package_name: pkg.name_en,
        package_name_de: pkg.name_de,
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
        ki_kontingent_monat: pkg.ki_kontingent_monat,
    };
};

module.exports = {
    SUBSCRIPTION_PACKAGES,
    PLAN_TO_PACKAGE,
    PACKAGE_TO_PLAN,
    packageIdFromPlan,
    packageById,
    packageFromStudioPlan,
    resolveStudioFinanceTerms,
    hasOverrideValue,
};

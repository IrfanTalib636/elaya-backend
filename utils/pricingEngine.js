const { CASE_TYPE, TC_TYPE, TC_COVERUP, GOAL_TARGET } = require('../config/constants');
const { TC_AGE_BUCKET_TO_MULT_KEY, FITZ_TYPE_TO_INT } = require('../config/caseIntakeEnums');
const {
    DEFAULT_PRICING_CONFIG,
    SIZE_MIDPOINTS,
    DIFFICULT_COLORS,
    BLACK_FAMILY_COLORS,
    BODY_LOCATION_KEYS,
} = require('../config/pricingDefaults');
const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
const {
    estimateSessionsFromConfig,
    estimatePmuSessionsFromConfig,
} = require('./sessionPredictionEngine');
const { attachEstimateReview } = require('./engineReview');

const roundToNearest5 = (value) => Math.round(value / 5) * 5;

const roundSessionPrice = (value) => Math.ceil(value / 5) * 5;

const round2 = (value) => Math.round(value * 100) / 100;

const mergePricingConfig = (overrides = {}) => ({
    ...DEFAULT_PRICING_CONFIG,
    ...overrides,
});

/**
 * Ink-density surcharge per zone.
 *
 * Keys must match the `QUALITY_LEVEL` values both clients send (`low`…
 * `very_high`). The German aliases are kept so zones stored before the naming
 * was aligned still resolve instead of silently falling back to 1.0.
 */
const ZONE_DICHTE_MULT = {
    low: 0.85,
    medium: 1.0,
    high: 1.15,
    very_high: 1.3,
    leicht: 0.85,
    mittel: 1.0,
    dicht: 1.15,
    sehr_dicht: 1.3,
};

const resolveArea = (caseInput) => {
    const explicitArea = parseFloat(caseInput.flaeche_cm2);
    if (explicitArea > 0) {
        return explicitArea;
    }

    const length = parseFloat(caseInput.tc_size_length);
    const width = parseFloat(caseInput.tc_size_width);

    if (length > 0 && width > 0) {
        return length * width;
    }

    if (caseInput.size && SIZE_MIDPOINTS[caseInput.size]) {
        return SIZE_MIDPOINTS[caseInput.size];
    }

    return 10;
};

const resolveAgeMultKey = (caseInput) => {
    if (caseInput.tc_age_bucket && TC_AGE_BUCKET_TO_MULT_KEY[caseInput.tc_age_bucket]) {
        return TC_AGE_BUCKET_TO_MULT_KEY[caseInput.tc_age_bucket];
    }

    const tcAgeYears = caseInput.tc_age_years;
    if (tcAgeYears == null || Number.isNaN(Number(tcAgeYears))) {
        return 'age_5to10';
    }

    const years = Number(tcAgeYears);
    // Price bands from Multipliers + Examples: 3 years = ×1.05 (3–5), 8 years = ×1.0 (5–10), 2 years = ×1.1 (1–3).
    if (years < 1) return 'age_under1';
    if (years < 3) return 'age_1to3';
    if (years < 5) return 'age_3to5';
    if (years <= 10) return 'age_5to10';
    return 'age_over10';
};

const resolveFitzInt = (caseInput) => {
    if (caseInput.skin_fitzpatrick_type && FITZ_TYPE_TO_INT[caseInput.skin_fitzpatrick_type]) {
        return FITZ_TYPE_TO_INT[caseInput.skin_fitzpatrick_type];
    }
    return Math.min(6, Math.max(1, Number(caseInput.skin_fitzpatrick) || 3));
};

const resolveBodyLocation = (caseInput) => {
    const raw =
        caseInput.tc_body_location_main ||
        caseInput.tc_body_location ||
        caseInput.koerperstelle ||
        '';

    const normalized = String(raw).toLowerCase().trim();
    if (BODY_LOCATION_KEYS.includes(normalized)) {
        return normalized;
    }

    return 'arm';
};

/**
 * Which colour multiplier applies.
 *
 * Returns the config key as well as the value, so a price breakdown can name the
 * multiplier that was used instead of showing a bare number.
 */
const resolveColorMultiplier = (colors, config) => {
    const list = Array.isArray(colors) ? colors.filter(Boolean) : [];
    // Excel Multiplikatoren: Weiss/Gelb/Hautfarbe dominates.
    if (list.some((color) => DIFFICULT_COLORS.includes(color))) {
        return { key: 'color_difficult', value: config.color_difficult };
    }
    // Nur Schwarz (grey counts as black). Extra chromatic inks: +1–2 → 1.2, 3+ → 1.4.
    const extra = list.filter((color) => !BLACK_FAMILY_COLORS.includes(color));
    if (extra.length === 0) return { key: 'color_black', value: config.color_black };
    if (extra.length <= 2) return { key: 'color_mixed', value: config.color_mixed };
    return { key: 'color_multi', value: config.color_multi };
};

/** Which ink-depth multiplier applies, with the config key it came from. */
const resolveDepthMultiplier = (caseInput, config) => {
    const at = (key) => ({ key, value: config[key] });

    const explicit =
        caseInput.tc_depth ||
        caseInput.stichtiefe ||
        caseInput.depth ||
        (caseInput.type !== CASE_TYPE.PMU ? caseInput.stitch_depth : null);

    // Input aliases (German and English) mapped onto the config keys.
    const depthMap = {
        shallow: 'depth_shallow',
        surface: 'depth_shallow',
        oberflaechlich: 'depth_shallow',
        amateur: 'depth_shallow',
        normal: 'depth_normal',
        medium: 'depth_normal',
        tief: 'depth_deep',
        deep: 'depth_deep',
        professional: 'depth_deep',
        very_deep: 'depth_very_deep',
        sehr_tief: 'depth_very_deep',
        coverup: 'depth_very_deep',
        unknown: 'depth_normal',
        weiss_nicht: 'depth_normal',
    };
    const alias = explicit ? depthMap[String(explicit).toLowerCase()] : null;
    if (alias && config[alias] != null) {
        return at(alias);
    }

    // Excel: Very deep / Cover-up = 1.3 (example 3 uses both layering ×1.4 and depth ×1.3).
    if (
        caseInput.tc_coverup === TC_COVERUP.ONCE ||
        caseInput.tc_coverup === TC_COVERUP.MULTIPLE
    ) {
        return at('depth_very_deep');
    }

    // Excel: Oberflächlich/Amateur=0.9, Normal=1.0, Tief (professionell)=1.1, Cover-Up=1.3.
    if ([TC_TYPE.AMATEUR, TC_TYPE.COSMETIC].includes(caseInput.tc_type)) {
        return at('depth_shallow');
    }
    if (caseInput.tc_type === TC_TYPE.PROFESSIONAL) {
        return at('depth_deep');
    }
    if (caseInput.tc_type === TC_TYPE.COVERUP) {
        return at('depth_very_deep');
    }
    return at('depth_normal');
};

const resolveMultipliers = (caseInput, config) => {
    const color = resolveColorMultiplier(caseInput.tc_colors_present, config);
    const depth = resolveDepthMultiplier(caseInput, config);
    const colorM = color.value;
    const depthM = depth.value;

    const ageKey = resolveAgeMultKey(caseInput);
    const ageM = config[ageKey] ?? 1.0;

    const fitzInt = resolveFitzInt(caseInput);
    const skinKey = `skin_${fitzInt}`;
    const skinM = config[skinKey] ?? 1.0;

    const location = resolveBodyLocation(caseInput);
    // Eleven body locations collapse onto seven configurable keys.
    const locationMap = {
        face: 'location_face',
        neck: 'location_neck',
        chest: 'location_torso',
        back: 'location_torso',
        shoulder: 'location_torso',
        abdomen: 'location_torso',
        hip: 'location_torso',
        arm: 'location_arm',
        leg: 'location_leg',
        hand: 'location_hand',
        foot: 'location_foot',
    };
    const locKey = locationMap[location] ?? 'location_arm';
    const locM = config[locKey] ?? config.location_arm;

    let layKey = 'layering_none';
    if (caseInput.tc_coverup === TC_COVERUP.MULTIPLE) {
        layKey = 'layering_multi';
    } else if (caseInput.tc_coverup === TC_COVERUP.ONCE) {
        layKey = 'layering_once';
    }
    const layM = config[layKey];

    let goalKey = 'goal_full';
    if (
        caseInput.goal_target === GOAL_TARGET.PARTIAL_FADE
    ) {
        goalKey = 'goal_partial';
    } else if (caseInput.goal_target === GOAL_TARGET.LIGHTENING_FOR_COVERUP) {
        goalKey = 'goal_lighten';
    }
    const goalM = config[goalKey];

    return {
        colorM,
        depthM,
        ageM,
        skinM,
        locM,
        layM,
        goalM,
        bodyLocation: location,
        /** Config key each multiplier was read from, for the price breakdown. */
        keys: {
            color: color.key,
            depth: depth.key,
            age: ageKey,
            skin: skinKey,
            location: locKey,
            layering: layKey,
            goal: goalKey,
        },
    };
};

const computeConfidence = (caseInput) => {
    const colors = caseInput.tc_colors_present || [];
    const missing = [
        !caseInput.tc_size_length,
        !caseInput.tc_size_width,
        !(caseInput.skin_fitzpatrick_type || caseInput.skin_fitzpatrick),
        !colors.length,
        !(caseInput.tc_body_location_main ||
            caseInput.tc_body_location ||
            caseInput.koerperstelle),
    ].filter(Boolean).length;

    return Math.max(40, 100 - missing * 15);
};

const splitOverrides = (overrides = {}) => {
    const { session_prediction, ...pricingOverrides } = overrides;
    return {
        pricingOverrides,
        sessionPrediction: mergeSessionPrediction(session_prediction),
    };
};

/**
 * Session estimate from platform Sitzungsprognose parameters (Master Excel).
 */
const estimateSessions = (caseInput, sessionPrediction = {}) => {
    const result = estimateSessionsFromConfig(caseInput, sessionPrediction);
    return {
        ...result,
        confidence_pct: result.confidence_score ?? computeConfidence(caseInput),
    };
};

const calculatePriceForInput = (caseInput, pricingOverrides = {}, options = {}) => {
    const { pricingOverrides: pricingOnly } = splitOverrides(pricingOverrides);
    const config = mergePricingConfig(pricingOnly);
    const dichteMult = options.dichteMult ?? 1;

    if (caseInput.type === CASE_TYPE.PMU) {
        const pmuPrice = config.pmuPrice ?? 149;
        return {
            type: CASE_TYPE.PMU,
            area: null,
            pricePerSession: pmuPrice,
            rawPrice: pmuPrice,
            confidence_pct: 100,
            multipliers: null,
            // PMU is a flat price, so the breakdown is a single row.
            breakdown: {
                area: null,
                basePricePerCm2: null,
                steps: [{ id: 'pmu_base', config_key: 'pmuPrice', value: pmuPrice, running: pmuPrice }],
                rawPrice: pmuPrice,
                roundedPrice: pmuPrice,
                minPrice: null,
                minPriceApplied: false,
                pricePerSession: pmuPrice,
            },
        };
    }

    const area = Math.round(resolveArea(caseInput) * 10) / 10;
    const multipliers = resolveMultipliers(caseInput, config);
    const basePricePerCm2 = config.basePricePerCm2 ?? 3;
    // Excel Preisformel:
    // Rohpreis = Fläche × Basis × Farbe × Tiefe × Alter × Haut × Stelle × CoverUp × Ziel
    // Preis/Sitzung = MAX(Mindestpreis, Rohpreis auf nächste 5 CHF aufgerundet)
    const product =
        area *
        basePricePerCm2 *
        multipliers.colorM *
        multipliers.depthM *
        multipliers.ageM *
        multipliers.skinM *
        multipliers.locM *
        multipliers.layM *
        multipliers.goalM *
        dichteMult;

    const rounded = roundSessionPrice(product);
    const pricePerSession = Math.max(config.minPrice ?? 90, rounded);

    // Ordered walk of the same formula, so a studio can see how each of its own
    // values moves the price. `running` is the subtotal after applying the step.
    const steps = [];
    let running = area * basePricePerCm2;
    steps.push({
        id: 'base',
        config_key: 'basePricePerCm2',
        value: basePricePerCm2,
        running: round2(running),
    });
    const factorSteps = [
        ['color', multipliers.keys.color, multipliers.colorM],
        ['depth', multipliers.keys.depth, multipliers.depthM],
        ['age', multipliers.keys.age, multipliers.ageM],
        ['skin', multipliers.keys.skin, multipliers.skinM],
        ['location', multipliers.keys.location, multipliers.locM],
        ['layering', multipliers.keys.layering, multipliers.layM],
        ['goal', multipliers.keys.goal, multipliers.goalM],
    ];
    for (const [id, configKey, value] of factorSteps) {
        running *= value;
        steps.push({ id, config_key: configKey, value, running: round2(running) });
    }
    if (dichteMult !== 1) {
        running *= dichteMult;
        // Density is a platform constant, not a studio-editable value.
        steps.push({ id: 'density', config_key: null, value: dichteMult, running: round2(running) });
    }

    return {
        type: CASE_TYPE.TATTOO,
        area,
        pricePerSession,
        rawPrice: Math.round(product * 100) / 100,
        confidence_pct: computeConfidence(caseInput),
        multipliers: {
            color: multipliers.colorM,
            depth: multipliers.depthM,
            age: multipliers.ageM,
            skin: multipliers.skinM,
            location: multipliers.locM,
            layering: multipliers.layM,
            goal: multipliers.goalM,
            bodyLocation: multipliers.bodyLocation,
            keys: multipliers.keys,
        },
        basePricePerCm2: config.basePricePerCm2,
        minPrice: config.minPrice,
        breakdown: {
            area,
            basePricePerCm2,
            steps,
            rawPrice: round2(product),
            roundedPrice: rounded,
            minPrice: config.minPrice ?? 90,
            // True when the minimum floor, not the formula, decided the price.
            minPriceApplied: pricePerSession > rounded,
            pricePerSession,
        },
    };
};

/**
 * Prototype calcPmuSessions — session estimate for PMU intake.
 */
const calcPmuSessions = (caseInput = {}, sessionPrediction = {}) => {
    const result = estimatePmuSessionsFromConfig(caseInput, sessionPrediction);
    return {
        ...result,
        confidence_pct: 100,
    };
};

/**
 * Full intake preview — price + sessions for single tattoo, zone mode, or PMU.
 */
const calculateCasePreview = (caseInput, pricingOverrides = {}) => {
    const { sessionPrediction } = splitOverrides(pricingOverrides);

    if (caseInput.type === CASE_TYPE.PMU) {
        const price = calculatePriceForInput(caseInput, pricingOverrides);
        const sessions = calcPmuSessions(caseInput, sessionPrediction);

        return attachEstimateReview(
            {
                ...formatStudioPricing(price),
                sessions,
                totalMin: price.pricePerSession * sessions.min,
                totalMax: price.pricePerSession * sessions.max,
                zonen: null,
            },
            caseInput
        );
    }

    if (caseInput.zonen_aktiv && Array.isArray(caseInput.zonen) && caseInput.zonen.length > 0) {
        const zoneRows = caseInput.zonen.map((zone) => {
            const zoneInput = {
                ...caseInput,
                tc_colors_present: zone.farben || [],
                tc_body_location_main: zone.koerperstelle || caseInput.tc_body_location_main,
                // The zone's own measurements — never the case-level ones, which
                // describe the tattoo as a whole.
                flaeche_cm2: zone.flaeche_cm2,
                tc_size_length: zone.laenge_cm ?? null,
                tc_size_width: zone.breite_cm ?? null,
            };
            const dichteMult = ZONE_DICHTE_MULT[zone.dichte] ?? 1;
            const price = calculatePriceForInput(zoneInput, pricingOverrides, { dichteMult });
            const sessions = estimateSessions(zoneInput, sessionPrediction);

            return {
                label: zone.bezeichnung || 'Zone',
                preis: price.pricePerSession,
                area: price.area,
                sessions,
            };
        });

        const pricePerSession = zoneRows.reduce((sum, row) => sum + row.preis, 0);
        const sessionsMin = Math.max(0, ...zoneRows.map((row) => row.sessions.min));
        const sessionsMax = Math.max(0, ...zoneRows.map((row) => row.sessions.max));
        const totalArea = zoneRows.reduce((sum, row) => sum + (row.area || 0), 0);
        const confidence_pct = Math.min(...zoneRows.map((row) => row.sessions.confidence_pct));
        const review_triggers = [
            ...new Set(zoneRows.flatMap((row) => row.sessions.review_triggers || [])),
        ];

        return attachEstimateReview(
            {
                type: CASE_TYPE.TATTOO,
                area: Math.round(totalArea * 10) / 10,
                pricePerSession,
                confidence_pct,
                sessions: {
                    min: sessionsMin,
                    max: sessionsMax,
                    base: sessionsMax,
                    confidence_pct,
                    needs_human_review: zoneRows.some((row) => row.sessions.needs_human_review),
                    review_triggers,
                },
                zonen: zoneRows,
                totalMin: pricePerSession * sessionsMin,
                totalMax: pricePerSession * sessionsMax,
                currency: 'CHF',
                multipliers: null,
                review_triggers,
                needs_human_review: zoneRows.some((row) => row.sessions.needs_human_review),
            },
            caseInput
        );
    }

    const price = calculatePriceForInput(caseInput, pricingOverrides);
    const sessions = estimateSessions(caseInput, sessionPrediction);

    return attachEstimateReview(
        {
            ...formatStudioPricing(price),
            sessions,
            totalMin: price.pricePerSession * sessions.min,
            totalMax: price.pricePerSession * sessions.max,
            zonen: null,
        },
        caseInput
    );
};

/**
 * 7-factor session price (Excel PriceFormula + Examples).
 * Plausibility: scripts/verifyExcelExamples.js / IT_Clarifications §7.
 */
const calculatePrice = (caseInput, pricingOverrides = {}) =>
    calculatePriceForInput(caseInput, pricingOverrides);

const calculateGroupPricing = (cases, pricingOverrides = {}) => {
    const { pricingOverrides: pricingOnly } = splitOverrides(pricingOverrides);
    const config = mergePricingConfig(pricingOnly);
    const einzel = cases.map((caseDoc) => {
        const result = calculatePrice(caseDoc, config);
        return {
            case_id: caseDoc._id?.toString() || caseDoc.id,
            label: caseDoc.bodyLabel || caseDoc.tc_title || 'Case',
            preis: result.pricePerSession,
        };
    });

    const zwischensumme = einzel.reduce((sum, row) => sum + row.preis, 0);
    const rabattPct = config.gruppen_rabatt ?? 0.15;
    const gesamt = roundToNearest5(zwischensumme * (1 - rabattPct));
    const rabatt = zwischensumme - gesamt;

    return {
        einzel,
        zwischensumme,
        rabatt,
        rabattPct,
        gesamt,
    };
};

/** Pricing keys that are multipliers rather than absolute CHF amounts. */
const MULTIPLIER_KEY_PREFIXES = [
    'color_',
    'depth_',
    'age_',
    'skin_',
    'location_',
    'layering_',
    'goal_',
];

const isMultiplierKey = (key) => MULTIPLIER_KEY_PREFIXES.some((p) => key.startsWith(p));

/**
 * Flag pricing values that would produce a nonsensical price, so a studio finds
 * out while editing rather than from a customer quote.
 *
 * `error` means the price is definitely wrong (a zero multiplier collapses the
 * whole formula); `warning` means the value is legal but far outside the range
 * studios normally use.
 */
const checkPricingConfig = (overrides = {}) => {
    const config = mergePricingConfig(overrides);
    const issues = [];

    const amounts = [
        ['basePricePerCm2', 0],
        ['pmuPrice', 0],
    ];
    for (const [key, floor] of amounts) {
        const value = config[key];
        if (typeof value !== 'number' || Number.isNaN(value) || value <= floor) {
            issues.push({ key, value, severity: 'error', code: 'must_be_positive' });
        }
    }

    if (typeof config.minPrice !== 'number' || config.minPrice < 0) {
        issues.push({
            key: 'minPrice',
            value: config.minPrice,
            severity: 'error',
            code: 'must_not_be_negative',
        });
    }

    for (const key of Object.keys(DEFAULT_PRICING_CONFIG)) {
        if (!isMultiplierKey(key)) continue;
        const value = config[key];
        if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
            // A zero or negative multiplier wipes out every price it touches.
            issues.push({ key, value, severity: 'error', code: 'multiplier_must_be_positive' });
        } else if (value > 5) {
            issues.push({ key, value, severity: 'warning', code: 'multiplier_unusually_high' });
        }
    }

    return {
        ok: issues.every((i) => i.severity !== 'error'),
        issues,
    };
};

/**
 * Price preview for the studio's pricing settings.
 *
 * Runs the real engine twice — once with the saved config and once with the
 * unsaved draft — so the UI can show the effect of an edit before it is saved.
 */
const previewPricing = (caseInput = {}, draftPricing = {}, options = {}) => {
    const live = calculatePriceForInput(caseInput, draftPricing);
    const baselinePricing = options.baselinePricing;
    const baseline =
        baselinePricing != null ? calculatePriceForInput(caseInput, baselinePricing) : null;

    return {
        case_input: caseInput,
        live: formatStudioPricing(live),
        baseline: baseline ? formatStudioPricing(baseline) : null,
        delta: baseline
            ? {
                  pricePerSession: round2(live.pricePerSession - baseline.pricePerSession),
                  rawPrice: round2((live.rawPrice ?? 0) - (baseline.rawPrice ?? 0)),
              }
            : null,
        config_check: checkPricingConfig(draftPricing),
    };
};

const formatCustomerEstimate = (result) => ({
    priceFrom: result.pricePerSession,
    area: result.area,
    confidence_pct: result.confidence_pct,
    type: result.type,
    sessionsMin: result.sessions?.min,
    sessionsMax: result.sessions?.max,
    totalMin: result.totalMin,
    totalMax: result.totalMax,
});

const formatCustomerPreview = (result) => formatCustomerEstimate(result);

const formatStudioPricing = (result) => ({
    ...result,
    currency: 'CHF',
});

module.exports = {
    calculatePrice,
    calculateCasePreview,
    calculateGroupPricing,
    previewPricing,
    checkPricingConfig,
    estimateSessions,
    calcPmuSessions,
    formatCustomerEstimate,
    formatCustomerPreview,
    formatStudioPricing,
    mergePricingConfig,
    resolveArea,
};

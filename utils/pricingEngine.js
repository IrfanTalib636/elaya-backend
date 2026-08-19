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

const mergePricingConfig = (overrides = {}) => ({
    ...DEFAULT_PRICING_CONFIG,
    ...overrides,
});

const ZONE_DICHTE_MULT = {
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

const resolveColorMultiplier = (colors, config) => {
    const list = Array.isArray(colors) ? colors.filter(Boolean) : [];
    // Excel Multiplikatoren: Weiss/Gelb/Hautfarbe dominates.
    if (list.some((color) => DIFFICULT_COLORS.includes(color))) {
        return config.color_difficult;
    }
    // Nur Schwarz (grey counts as black). Extra chromatic inks: +1–2 → 1.2, 3+ → 1.4.
    const extra = list.filter((color) => !BLACK_FAMILY_COLORS.includes(color));
    if (extra.length === 0) return config.color_black;
    if (extra.length <= 2) return config.color_mixed;
    return config.color_multi;
};

const resolveDepthMultiplier = (caseInput, config) => {
    const explicit =
        caseInput.tc_depth ||
        caseInput.stichtiefe ||
        caseInput.depth ||
        (caseInput.type !== CASE_TYPE.PMU ? caseInput.stitch_depth : null);

    const depthMap = {
        shallow: config.depth_shallow,
        surface: config.depth_shallow,
        oberflaechlich: config.depth_shallow,
        amateur: config.depth_shallow,
        normal: config.depth_normal,
        medium: config.depth_normal,
        tief: config.depth_deep,
        deep: config.depth_deep,
        professional: config.depth_deep,
        very_deep: config.depth_very_deep,
        sehr_tief: config.depth_very_deep,
        coverup: config.depth_very_deep,
        unknown: config.depth_normal,
        weiss_nicht: config.depth_normal,
    };
    if (explicit && depthMap[String(explicit).toLowerCase()] != null) {
        return depthMap[String(explicit).toLowerCase()];
    }

    // Excel: Very deep / Cover-up = 1.3 (example 3 uses both layering ×1.4 and depth ×1.3).
    if (
        caseInput.tc_coverup === TC_COVERUP.ONCE ||
        caseInput.tc_coverup === TC_COVERUP.MULTIPLE
    ) {
        return config.depth_very_deep;
    }

    // Excel: Oberflächlich/Amateur=0.9, Normal=1.0, Tief (professionell)=1.1, Cover-Up=1.3.
    if ([TC_TYPE.AMATEUR, TC_TYPE.COSMETIC].includes(caseInput.tc_type)) {
        return config.depth_shallow;
    }
    if (caseInput.tc_type === TC_TYPE.PROFESSIONAL) {
        return config.depth_deep;
    }
    if (caseInput.tc_type === TC_TYPE.COVERUP) {
        return config.depth_very_deep;
    }
    return config.depth_normal;
};

const resolveMultipliers = (caseInput, config) => {
    const colorM = resolveColorMultiplier(caseInput.tc_colors_present, config);
    const depthM = resolveDepthMultiplier(caseInput, config);

    const ageM = config[resolveAgeMultKey(caseInput)] ?? 1.0;

    const fitzInt = resolveFitzInt(caseInput);
    const skinM = config[`skin_${fitzInt}`] ?? 1.0;

    const location = resolveBodyLocation(caseInput);
    const locationMap = {
        face: config.location_face,
        neck: config.location_neck,
        chest: config.location_torso,
        back: config.location_torso,
        shoulder: config.location_torso,
        abdomen: config.location_torso,
        hip: config.location_torso,
        arm: config.location_arm,
        leg: config.location_leg,
        hand: config.location_hand,
        foot: config.location_foot,
    };
    const locM = locationMap[location] ?? config.location_arm;

    let layM = config.layering_none;
    if (caseInput.tc_coverup === TC_COVERUP.MULTIPLE) {
        layM = config.layering_multi;
    } else if (caseInput.tc_coverup === TC_COVERUP.ONCE) {
        layM = config.layering_once;
    }

    let goalM = config.goal_full;
    if (
        caseInput.goal_target === GOAL_TARGET.PARTIAL_FADE
    ) {
        goalM = config.goal_partial;
    } else if (caseInput.goal_target === GOAL_TARGET.LIGHTENING_FOR_COVERUP) {
        goalM = config.goal_lighten;
    }

    return {
        colorM,
        depthM,
        ageM,
        skinM,
        locM,
        layM,
        goalM,
        bodyLocation: location,
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
        return {
            type: CASE_TYPE.PMU,
            area: null,
            pricePerSession: config.pmuPrice ?? 149,
            confidence_pct: 100,
            multipliers: null,
        };
    }

    const area = Math.round(resolveArea(caseInput) * 10) / 10;
    const multipliers = resolveMultipliers(caseInput, config);
    // Excel Preisformel:
    // Rohpreis = Fläche × Basis × Farbe × Tiefe × Alter × Haut × Stelle × CoverUp × Ziel
    // Preis/Sitzung = MAX(Mindestpreis, Rohpreis auf nächste 5 CHF aufgerundet)
    const product =
        area *
        (config.basePricePerCm2 ?? 3) *
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
        },
        basePricePerCm2: config.basePricePerCm2,
        minPrice: config.minPrice,
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
                flaeche_cm2: zone.flaeche_cm2,
                tc_size_length: null,
                tc_size_width: null,
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
    estimateSessions,
    calcPmuSessions,
    formatCustomerEstimate,
    formatCustomerPreview,
    formatStudioPricing,
    mergePricingConfig,
    resolveArea,
};

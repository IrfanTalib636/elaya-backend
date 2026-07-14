const { CASE_TYPE, TC_TYPE, TC_COVERUP, GOAL_TARGET } = require('../config/constants');
const { TC_AGE_BUCKET_TO_MULT_KEY, FITZ_TYPE_TO_INT } = require('../config/caseIntakeEnums');
const {
    DEFAULT_PRICING_CONFIG,
    SIZE_MIDPOINTS,
    DIFFICULT_COLORS,
    BODY_LOCATION_KEYS,
} = require('../config/pricingDefaults');

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
    if (years < 1) {
        return 'age_under1';
    }
    if (years <= 3) {
        return 'age_1to3';
    }
    if (years <= 7) {
        return 'age_3to5';
    }
    if (years <= 15) {
        return 'age_5to10';
    }
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

const resolveMultipliers = (caseInput, config) => {
    const colors = caseInput.tc_colors_present || [];
    let colorM = config.color_black;

    if (colors.some((color) => DIFFICULT_COLORS.includes(color))) {
        colorM = config.color_difficult;
    } else if (colors.length <= 1) {
        colorM = config.color_black;
    } else if (colors.length <= 3) {
        colorM = config.color_mixed;
    } else {
        colorM = config.color_multi;
    }

    let depthM = config.depth_normal;
    if ([TC_TYPE.AMATEUR, TC_TYPE.COSMETIC].includes(caseInput.tc_type)) {
        depthM = config.depth_shallow;
    } else if (caseInput.tc_type === TC_TYPE.PROFESSIONAL) {
        depthM = config.depth_deep;
    } else if (caseInput.tc_type === TC_TYPE.COVERUP) {
        depthM = config.depth_very_deep;
    }

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

/**
 * Session estimate (prototype calcSessions) — used in intake KI preview.
 */
const estimateSessions = (caseInput) => {
    let base = 8;
    const fitz = resolveFitzInt(caseInput);

    if (fitz >= 4) {
        base += 1;
    }
    if (fitz >= 5) {
        base += 1;
    }
    if (caseInput.tc_type === TC_TYPE.AMATEUR) {
        base -= 2;
    } else if (caseInput.tc_type === TC_TYPE.COVERUP) {
        base += 2;
    }
    if (caseInput.tc_coverup === TC_COVERUP.ONCE) {
        base += 1;
    } else if (caseInput.tc_coverup === TC_COVERUP.MULTIPLE) {
        base += 3;
    }
    if (caseInput.tc_prior_treatment === true) {
        base -= 1;
    }

    const colors = caseInput.tc_colors_present || [];
    if (colors.some((color) => DIFFICULT_COLORS.includes(color))) {
        base += 2;
    } else if (colors.length > 3) {
        base += 1;
    }

    if (caseInput.skin_sun_zone === 'high') {
        base += 1;
    }
    if (caseInput.life_smoker === 'daily_heavy') {
        base += 2;
    } else if (caseInput.life_smoker === 'daily_light') {
        base += 1;
    }
    if (caseInput.life_activity === 'high') {
        base -= 1;
    }

    base = Math.max(3, Math.min(20, base));

    return {
        base,
        min: Math.max(3, base - 2),
        max: base + 2,
        confidence_pct: computeConfidence(caseInput),
    };
};

const calculatePriceForInput = (caseInput, pricingOverrides = {}, options = {}) => {
    const config = mergePricingConfig(pricingOverrides);
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

    const pricePerSession = Math.max(config.minPrice ?? 90, roundSessionPrice(product));

    return {
        type: CASE_TYPE.TATTOO,
        area,
        pricePerSession,
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
 * Full intake preview — price + sessions for single tattoo or zone mode.
 */
const calculateCasePreview = (caseInput, pricingOverrides = {}) => {
    if (caseInput.type === CASE_TYPE.PMU) {
        const price = calculatePriceForInput(caseInput, pricingOverrides);
        const sessions = { min: 4, max: 8, base: 6, confidence_pct: 100 };

        return {
            ...formatStudioPricing(price),
            sessions,
            totalMin: price.pricePerSession * sessions.min,
            totalMax: price.pricePerSession * sessions.max,
            zonen: null,
        };
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
            const sessions = estimateSessions(zoneInput);

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

        return {
            type: CASE_TYPE.TATTOO,
            area: Math.round(totalArea * 10) / 10,
            pricePerSession,
            confidence_pct,
            sessions: {
                min: sessionsMin,
                max: sessionsMax,
                base: sessionsMax,
                confidence_pct,
            },
            zonen: zoneRows,
            totalMin: pricePerSession * sessionsMin,
            totalMax: pricePerSession * sessionsMax,
            currency: 'CHF',
            multipliers: null,
        };
    }

    const price = calculatePriceForInput(caseInput, pricingOverrides);
    const sessions = estimateSessions(caseInput);

    return {
        ...formatStudioPricing(price),
        sessions,
        totalMin: price.pricePerSession * sessions.min,
        totalMax: price.pricePerSession * sessions.max,
        zonen: null,
    };
};

/**
 * 7-factor session price (client §5d). Internal studio formula — customer sees estimate only.
 */
const calculatePrice = (caseInput, pricingOverrides = {}) =>
    calculatePriceForInput(caseInput, pricingOverrides);

const calculateGroupPricing = (cases, pricingOverrides = {}) => {
    const config = mergePricingConfig(pricingOverrides);
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
    formatCustomerEstimate,
    formatCustomerPreview,
    formatStudioPricing,
    mergePricingConfig,
    resolveArea,
};

const { CASE_TYPE, TC_TYPE, TC_COVERUP, GOAL_TARGET } = require('../config/constants');
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

const resolveArea = (caseInput) => {
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

const resolveAgeMultKey = (tcAgeYears) => {
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

    const ageM = config[resolveAgeMultKey(caseInput.tc_age_years)] ?? 1.0;

    const fitzInt = Math.min(6, Math.max(1, Number(caseInput.skin_fitzpatrick) || 3));
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
    if (caseInput.goal_target === GOAL_TARGET.PARTIAL_FADE) {
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
        !caseInput.skin_fitzpatrick,
        !colors.length,
        !(caseInput.tc_body_location_main ||
            caseInput.tc_body_location ||
            caseInput.koerperstelle),
    ].filter(Boolean).length;

    return Math.max(40, 100 - missing * 15);
};

/**
 * 7-factor session price (client §5d). Internal studio formula — customer sees estimate only.
 */
const calculatePrice = (caseInput, pricingOverrides = {}) => {
    const config = mergePricingConfig(pricingOverrides);

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
        multipliers.goalM;

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
});

const formatStudioPricing = (result) => ({
    ...result,
    currency: 'CHF',
});

module.exports = {
    calculatePrice,
    calculateGroupPricing,
    formatCustomerEstimate,
    formatStudioPricing,
    mergePricingConfig,
    resolveArea,
};

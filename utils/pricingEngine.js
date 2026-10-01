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
    if (list.some((color) => DIFFICULT_COLORS.includes(color))) {
        return { key: 'color_difficult', value: config.color_difficult };
    }
    const extra = list.filter((color) => !BLACK_FAMILY_COLORS.includes(color));
    if (extra.length === 0) return { key: 'color_black', value: config.color_black };
    if (extra.length <= 2) return { key: 'color_mixed', value: config.color_mixed };
    return { key: 'color_multi', value: config.color_multi };
};

const resolveDepthMultiplier = (caseInput, config) => {
    const at = (key) => ({ key, value: config[key] });

    const explicit =
        caseInput.tc_depth ||
        caseInput.stichtiefe ||
        caseInput.depth ||
        (caseInput.type !== CASE_TYPE.PMU ? caseInput.stitch_depth : null);

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

    if (
        caseInput.tc_coverup === TC_COVERUP.ONCE ||
        caseInput.tc_coverup === TC_COVERUP.MULTIPLE
    ) {
        return at('depth_very_deep');
    }

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
    const { session_prediction, laser_color_deltas, ...pricingOverrides } = overrides;
    return {
        pricingOverrides,
        sessionPrediction: mergeSessionPrediction(session_prediction),
        laserColorDeltas: laser_color_deltas,
    };
};

const withLaserColors = (caseInput, laserColorDeltas) => {
    if (caseInput.laser_color_deltas || !laserColorDeltas) return caseInput;
    return { ...caseInput, laser_color_deltas: laserColorDeltas };
};

const estimateSessions = (caseInput, sessionPrediction = {}) => {
    const result = estimateSessionsFromConfig(caseInput, sessionPrediction);
    return {
        ...result,
        confidence_pct: result.confidence_score ?? computeConfidence(caseInput),
    };
};

const calculatePriceForInput = (caseInput, pricingOverrides = {}) => {
    const { pricingOverrides: pricingOnly } = splitOverrides(pricingOverrides);
    const config = mergePricingConfig(pricingOnly);

    if (caseInput.type === CASE_TYPE.PMU) {
        const pmuPrice = config.pmuPrice ?? 149;
        return {
            type: CASE_TYPE.PMU,
            area: null,
            pricePerSession: pmuPrice,
            rawPrice: pmuPrice,
            confidence_pct: 100,
            multipliers: null,
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
    const basePricePerCm2 = config.basePricePerCm2 ?? 3;
  
    const raw = area * basePricePerCm2;
    const minPrice = config.minPrice ?? 90;
    const pricePerSession = roundSessionPrice(Math.max(minPrice, raw));
    const minPriceApplied = raw < minPrice;

    return {
        type: CASE_TYPE.TATTOO,
        area,
        pricePerSession,
        rawPrice: round2(raw),
        confidence_pct: computeConfidence(caseInput),
        multipliers: null,
        basePricePerCm2,
        minPrice,
        breakdown: {
            area,
            basePricePerCm2,
            steps: [
                {
                    id: 'base',
                    config_key: 'basePricePerCm2',
                    value: basePricePerCm2,
                    running: round2(raw),
                },
            ],
            rawPrice: round2(raw),
            roundedPrice: pricePerSession,
            minPrice,
            minPriceApplied,
            pricePerSession,
        },
    };
};

const calcPmuSessions = (caseInput = {}, sessionPrediction = {}) => {
    const result = estimatePmuSessionsFromConfig(caseInput, sessionPrediction);
    return {
        ...result,
        confidence_pct: 100,
    };
};

const calculateCasePreview = (caseInput, pricingOverrides = {}) => {
    const { sessionPrediction, laserColorDeltas } = splitOverrides(pricingOverrides);
    caseInput = withLaserColors(caseInput, laserColorDeltas);

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
                tc_size_length: zone.laenge_cm ?? null,
                tc_size_width: zone.breite_cm ?? null,
            };
            const price = calculatePriceForInput(zoneInput, pricingOverrides);
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

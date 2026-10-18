const VALUE_ALIASES = {
    '<5': 'under_5',
    under5: 'under_5',
    '7-9': '7-8',
    balanced: 'good',
    very_good: 'good',
    rather_good: 'good',
    mixed: 'fair',
    rather_bad: 'poor',
    very_bad: 'poor',
    very_poor: 'poor',
};

const lookupScore = (map, key) => {
    if (key == null || key === '' || !map) return null;
    const raw = String(key);
    const candidates = [raw, VALUE_ALIASES[raw]].filter(Boolean);
    for (const candidate of candidates) {
        if (map[candidate] == null || map[candidate] === '') continue;
        const n = Number(map[candidate]);
        if (Number.isFinite(n)) return n;
    }
    return null;
};

const average = (values) => {
    const nums = values.filter((n) => n != null && Number.isFinite(n));
    if (!nums.length) return null;
    return nums.reduce((sum, n) => sum + n, 0) / nums.length;
};

/** Composite factors, in the order shown in Calculation Details. */
const LIFESTYLE_FACTOR_KEYS = [
    'smoker',
    'alcohol',
    'sleep_score',
    'activity',
    'stress',
    'hydration',
    'nutrition',
];

const DEFAULT_FACTOR_WEIGHTS = {
    smoker: 3,
    alcohol: 2,
    sleep_score: 1,
    activity: 1,
    stress: 1,
    hydration: 2,
    nutrition: 1,
};

const weightFor = (key, cfg) => {
    const raw = cfg?.lifestyle_factor_weights?.[key];
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
    return DEFAULT_FACTOR_WEIGHTS[key];
};

const round2 = (n) => Math.round(n * 100) / 100;

const computeBmi = (heightCm, weightKg) => {
    const h = Number(heightCm);
    const w = Number(weightKg);
    if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return null;
    const meters = h / 100;
    return round2(w / (meters * meters));
};

const resolveSmokerScore = (caseInput, scores, cigsRules = []) => {
    let score = lookupScore(scores.smoker, caseInput.life_smoker);
    const cigs = Number(caseInput.life_cig_per_day);
    if (!Number.isFinite(cigs) || cigs <= 0 || !cigsRules.length) return score;

    const sorted = [...cigsRules].sort((a, b) => Number(b.min_cigs) - Number(a.min_cigs));
    for (const rule of sorted) {
        if (cigs >= Number(rule.min_cigs)) {
            const floor = Number(rule.min_score);
            score = score == null ? floor : Math.max(score, floor);
            break;
        }
    }
    return score;
};

const resolveActivityScore = (caseInput, scores) =>
    average([
        lookupScore(scores.activity, caseInput.life_activity),
        lookupScore(scores.sport_frequency, caseInput.life_sport_freq),
    ]);

const resolveSleepScore = (caseInput, scores) =>
    average([
        lookupScore(scores.sleep_hours, caseInput.life_sleep_hours),
        lookupScore(scores.sleep_quality, caseInput.life_sleep_quality),
    ]);

const resolveLifestyleBand = (avg, bands) => {
    const sorted = [...(bands || [])].sort((a, b) => a.max_avg - b.max_avg);
    if (!sorted.length) {
        return { score: 3, multiplier: 1 };
    }
    const match = sorted.find((band) => avg <= band.max_avg) || sorted[sorted.length - 1];
    return {
        score: Number(match.score) || 3,
        multiplier: Number(match.multiplier) || 1,
    };
};

/** Highest BMI threshold the value meets. Floors the discrete score, never the average. */
const matchingBmiFloor = (bmi, floors = []) => {
    if (bmi == null || !floors.length) return null;
    const sorted = [...floors].sort((a, b) => Number(b.min_bmi) - Number(a.min_bmi));
    for (const rule of sorted) {
        if (bmi >= Number(rule.min_bmi)) {
            return {
                min_bmi: Number(rule.min_bmi),
                min_score: Number(rule.min_score),
            };
        }
    }
    return null;
};

/** Multiplier of the band whose score matches. Used after a BMI floor raises the score. */
const multiplierForScore = (score, bands, fallback) => {
    const matches = (bands || []).filter((band) => Number(band.score) === Number(score));
    if (!matches.length) return fallback;
    matches.sort((a, b) => Number(a.max_avg) - Number(b.max_avg));
    const multiplier = Number(matches[matches.length - 1].multiplier);
    return Number.isFinite(multiplier) ? multiplier : fallback;
};

const computeLifestyleComposite = (caseInput = {}, cfg = {}) => {
    const scores = cfg.lifestyle_scores || {};
    const bands = cfg.lifestyle_bands || [];

    const factors = {
        smoker: resolveSmokerScore(caseInput, scores, cfg.lifestyle_smoker_cigs),
        alcohol: lookupScore(scores.alcohol, caseInput.life_alcohol),
        sleep_score: resolveSleepScore(caseInput, scores),
        stress: lookupScore(scores.stress, caseInput.life_stress),
        activity: resolveActivityScore(caseInput, scores),
        hydration: lookupScore(scores.hydration, caseInput.life_hydration),
        nutrition: lookupScore(scores.nutrition, caseInput.life_nutrition),
    };

    const bmi = computeBmi(caseInput.life_height_cm, caseInput.life_weight_kg);

    const weightLines = [];
    let weightedSum = 0;
    let weightSum = 0;
    for (const key of LIFESTYLE_FACTOR_KEYS) {
        const score = factors[key];
        if (score == null || !Number.isFinite(score)) continue;
        const weight = weightFor(key, cfg);
        if (!(weight > 0)) continue;
        weightedSum += score * weight;
        weightSum += weight;
        weightLines.push({
            key,
            score: round2(score),
            weight: round2(weight),
            contribution: round2(score * weight),
        });
    }

    const present = weightLines.map((line) => line.score);
    const averageValue = weightSum > 0 ? weightedSum / weightSum : null;
    const band =
        averageValue == null ? { score: 3, multiplier: 1 } : resolveLifestyleBand(averageValue, bands);
    const bmiFloor = matchingBmiFloor(bmi, cfg.lifestyle_bmi_floors);
    const scoreBeforeBmi = band.score;
    const score =
        bmiFloor && Number.isFinite(bmiFloor.min_score)
            ? Math.max(scoreBeforeBmi, bmiFloor.min_score)
            : scoreBeforeBmi;
    const multiplier =
        score === scoreBeforeBmi ? band.multiplier : multiplierForScore(score, bands, band.multiplier);
    const roundedAverage = averageValue == null ? null : round2(averageValue);

    return {
        score,
        score_before_bmi: scoreBeforeBmi,
        multiplier,
        average: roundedAverage,
        /** BMI never changes the average. The floor raises the discrete score only. */
        effective_average: roundedAverage,
        factors: Object.fromEntries(
            Object.entries(factors).map(([key, value]) => [
                key,
                value == null ? null : round2(value),
            ])
        ),
        factor_count: present.length,
        weighted_total: weightLines.length ? round2(weightedSum) : null,
        weight_total: weightLines.length ? round2(weightSum) : null,
        weight_lines: weightLines,
        sleep_hours: lookupScore(scores.sleep_hours, caseInput.life_sleep_hours),
        sleep_quality: lookupScore(scores.sleep_quality, caseInput.life_sleep_quality),
        bmi,
        bmi_floor: bmiFloor,
    };
};

module.exports = {
    computeLifestyleComposite,
    computeBmi,
    resolveLifestyleBand,
};

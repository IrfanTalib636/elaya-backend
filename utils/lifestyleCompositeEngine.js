/**
 * Lifestyle composite score — Master Excel IT_Clarifications §5.
 *
 * Average the 7 main factors (do not double-count sleep):
 *   smoker, alcohol, sleep_score, stress, activity, hydration, nutrition
 *
 * sleep_score = average(sleep_quality, sleep_hours)
 * Aftercare is NOT in this composite (compliance extra on max sessions).
 * BMI is internal only: it floors the discrete 1–5 score, it is not an 8th averaged factor.
 * SessionLogic extras absorbed here (not tattoo deltas): cigarettes_per_day, sport_frequency.
 */

const VALUE_ALIASES = {
    '<5': 'under_5',
    under5: 'under_5',
    '7-9': '7-8',
    balanced: 'very_good',
    rather_good: 'good',
    mixed: 'fair',
    rather_bad: 'poor',
    very_bad: 'very_poor',
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

const bandForScore = (score, bands) => {
    const match = (bands || []).find((band) => Number(band.score) === Number(score));
    if (!match) return { score, multiplier: 1 };
    return {
        score: Number(match.score) || score,
        multiplier: Number(match.multiplier) || 1,
    };
};

const applyBmiFloor = (score, bmi, floors = []) => {
    if (bmi == null || !floors.length) return { score, bmi_floor: null };
    const sorted = [...floors].sort((a, b) => Number(b.min_bmi) - Number(a.min_bmi));
    for (const rule of sorted) {
        if (bmi >= Number(rule.min_bmi)) {
            const floor = Number(rule.min_score);
            return { score: Math.max(score, floor), bmi_floor: floor };
        }
    }
    return { score, bmi_floor: null };
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

    const present = Object.values(factors).filter((n) => n != null && Number.isFinite(n));
    const bmi = computeBmi(caseInput.life_height_cm, caseInput.life_weight_kg);

    let averageValue = present.length ? present.reduce((sum, n) => sum + n, 0) / present.length : null;
    let { score, multiplier } =
        averageValue == null
            ? { score: 3, multiplier: 1 }
            : resolveLifestyleBand(averageValue, bands);

    const floored = applyBmiFloor(score, bmi, cfg.lifestyle_bmi_floors);
    if (floored.score > score) {
        ({ score, multiplier } = bandForScore(floored.score, bands));
    }

    return {
        score,
        multiplier,
        average: averageValue == null ? null : round2(averageValue),
        factors: Object.fromEntries(
            Object.entries(factors).map(([key, value]) => [
                key,
                value == null ? null : round2(value),
            ])
        ),
        factor_count: present.length,
        sleep_hours: lookupScore(scores.sleep_hours, caseInput.life_sleep_hours),
        sleep_quality: lookupScore(scores.sleep_quality, caseInput.life_sleep_quality),
        bmi,
        bmi_floor: floored.bmi_floor,
    };
};

module.exports = {
    computeLifestyleComposite,
    computeBmi,
    resolveLifestyleBand,
};

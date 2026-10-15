const { mergeSessionPrediction } = require('../config/sessionPredictionDefaults');
const { DEFAULT_PRICING_CONFIG } = require('../config/pricingDefaults');
const { mergeEngineExplainer } = require('../config/engineExplainerDefaults');

const fill = (template, vars) => {
    if (typeof template !== 'string') return template;
    return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) =>
        vars[key] == null ? '' : String(vars[key])
    );
};

const fillDeep = (node, vars) => {
    if (typeof node === 'string') return fill(node, vars);
    if (Array.isArray(node)) return node.map((item) => fillDeep(item, vars));
    if (node && typeof node === 'object') {
        return Object.fromEntries(
            Object.entries(node).map(([key, value]) => [key, fillDeep(value, vars)])
        );
    }
    return node;
};

const n = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const fmtChf = (value) =>
    Number(value).toLocaleString('de-CH', {
        minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
        maximumFractionDigits: 2,
    });

const bandName = (score, lang) => {
    const de = {
        1: 'Sehr guter Lifestyle',
        2: 'Guter Lifestyle',
        3: 'Normaler Lifestyle',
        4: 'Schlechter Lifestyle',
        5: 'Sehr schlechter Lifestyle',
    };
    const en = {
        1: 'Very good lifestyle',
        2: 'Good lifestyle',
        3: 'Normal lifestyle',
        4: 'Poor lifestyle',
        5: 'Very poor lifestyle',
    };
    const map = lang === 'en' ? en : de;
    return map[score] || (lang === 'en' ? `Score ${score}` : `Score ${score}`);
};

const bandTone = (score) => (score >= 4 ? 'poor' : score === 3 ? 'normal' : 'good');

const bandEffect = (multiplier, lang) => {
    const pct = Math.round((n(multiplier, 1) - 1) * 100);
    if (pct === 0) return lang === 'en' ? '±0%' : '±0%';
    const sign = pct > 0 ? '+' : '−';
    return lang === 'en'
        ? `${sign}${Math.abs(pct)}% sessions`
        : `${sign}${Math.abs(pct)}% Sitzungen`;
};

/**
 * Numbers and teaching examples taken from the actual Engine config —
 * never from documentation copy.
 */
const buildEngineFacts = (sessionPrediction = {}, pricing = {}, lang = 'de') => {
    const session = mergeSessionPrediction(sessionPrediction);
    const price = { ...DEFAULT_PRICING_CONFIG, ...(pricing || {}) };
    const deltas = session.tattoo_deltas || {};
    const en = lang === 'en';

    const base = n(session.base_sessions, 8);
    const minSessions = n(session.min_sessions, 3);
    const maxSessions = n(session.max_sessions, 20);
    const rangeMinus = Math.abs(n(session.range_minus, 1));
    const rangePlus = Math.abs(n(session.range_plus, 1));
    const aggregation = session.color_aggregation === 'sum' ? 'sum' : 'max';
    const roundTo = Math.max(1, n(price.price_round_to, 5));
    const pricePerCm2 = n(price.basePricePerCm2, 3);
    const minPrice = n(price.minPrice, 90);
    const extraMaxLow = n(session.aftercare_extra_max?.low, 0);

    const fitzIv = n(deltas.fitzpatrick?.IV, 1);
    const green = n(deltas.color?.green, 3);
    const hand = n(deltas.location?.hand, 1);
    const colorCount = n(deltas.color_count?.one_two, 1);
    const colorImpact =
        aggregation === 'sum' ? green + colorCount : Math.max(green, colorCount);
    const tattooDelta = fitzIv + colorImpact + hand;
    const raw = base + tattooDelta;

    const bands = (session.lifestyle_bands || []).map((band, i, all) => {
        const prev = i === 0 ? 0 : n(all[i - 1].max_avg);
        const maxAvg = n(band.max_avg);
        const score = n(band.score, i + 1);
        const multiplier = n(band.multiplier, 1);
        return {
            range:
                i === 0
                    ? `Score 0–${maxAvg}`
                    : `Score ${prev}–${maxAvg}`,
            name: bandName(score, lang),
            effect: bandEffect(multiplier, lang),
            tone: bandTone(score),
            score,
            multiplier,
            max_avg: maxAvg,
        };
    });

    const multiplierForScore = (score) => {
        const match = bands.find((band) => band.score === score);
        return match ? match.multiplier : score === 3 ? 1 : score === 4 ? 1.2 : score === 5 ? 1.5 : 1;
    };

    const apply = (rawValue, multiplier) => {
        const mid = Math.max(minSessions, Math.min(maxSessions, Math.round(rawValue * multiplier)));
        const min = Math.max(minSessions, mid - rangeMinus);
        const max = mid + rangePlus;
        return { mid, min, max, rawMid: Math.round(rawValue * multiplier * 100) / 100 };
    };

    const normal = apply(raw, multiplierForScore(3));
    const poor = apply(raw, multiplierForScore(4));
    const veryPoor = apply(raw, multiplierForScore(5));
    const plusOneNormal = apply(raw + 1, multiplierForScore(3));
    const plusOnePoor = apply(raw + 1, multiplierForScore(4));
    const plusOneVeryPoor = apply(raw + 1, multiplierForScore(5));

    const exampleArea = 40;
    const rawPrice = exampleArea * pricePerCm2;
    const roundedPrice = Math.ceil(Math.max(minPrice, rawPrice) / roundTo) * roundTo;
    const totalMin = roundedPrice * normal.min;
    const totalMax = roundedPrice * normal.max;

    const colorRule = en
        ? aggregation === 'sum'
            ? 'SUM(hardest colour delta + colour-count delta)'
            : 'MAX(hardest colour delta, colour-count delta)'
        : aggregation === 'sum'
          ? 'SUMME(schwierigste Farbe + Farbanzahl-Delta)'
          : 'MAX(schwierigste Farbe, Farbanzahl-Delta)';

    const aftercareNote =
        extraMaxLow > 0
            ? en
                ? `. Low aftercare commitment can add up to +${extraMaxLow} on the max`
                : `. Geringe Nachsorge-Bereitschaft kann das Maximum um bis zu +${extraMaxLow} erhöhen`
            : '';

    return {
        lang,
        base_sessions: base,
        min_sessions: minSessions,
        max_sessions: maxSessions,
        range_minus: rangeMinus,
        range_plus: rangePlus,
        price_per_cm2: fmtChf(pricePerCm2),
        min_price: fmtChf(minPrice),
        price_round_to: roundTo,
        color_aggregation: aggregation,
        color_aggregation_rule: colorRule,
        aftercare_note: aftercareNote,
        treatment_key: session.treatment_key || 'tattoo',
        bands,
        example: {
            fitzIv,
            green,
            hand,
            colorImpact,
            tattooDelta,
            raw,
            area: exampleArea,
            pricePerSession: roundedPrice,
            totalMin,
            totalMax,
            normal,
            poor,
            veryPoor,
            plusOneNormal,
            plusOnePoor,
            plusOneVeryPoor,
            mNormal: multiplierForScore(3),
            mPoor: multiplierForScore(4),
            mVeryPoor: multiplierForScore(5),
        },
        session,
        price,
    };
};

const interpolateExplainer = (explainer, facts) => fillDeep(explainer, facts);

const buildHowItWorksView = (facts, explainer, lang = 'de') => {
    const copy = interpolateExplainer(
        mergeEngineExplainer(explainer)[lang === 'en' ? 'en' : 'de'],
        facts
    );
    const ex = facts.example;
    const en = lang === 'en';

    copy.delta = {
        ...copy.delta,
        rows: [
            { label: en ? 'Base' : 'Basis', value: String(facts.base_sessions) },
            { label: en ? `Type IV (Δ${ex.fitzIv >= 0 ? '+' : ''}${ex.fitzIv})` : `Typ IV (Δ${ex.fitzIv >= 0 ? '+' : ''}${ex.fitzIv})`, value: `${ex.fitzIv >= 0 ? '+' : ''}${ex.fitzIv}` },
            { label: en ? `Green (Δ${ex.green >= 0 ? '+' : ''}${ex.green})` : `Grün (Δ${ex.green >= 0 ? '+' : ''}${ex.green})`, value: `${ex.green >= 0 ? '+' : ''}${ex.green}` },
            { label: en ? `Hand (Δ${ex.hand >= 0 ? '+' : ''}${ex.hand})` : `Hand (Δ${ex.hand >= 0 ? '+' : ''}${ex.hand})`, value: `${ex.hand >= 0 ? '+' : ''}${ex.hand}` },
        ],
        rawValue: String(ex.raw),
        multipliers: [
            en
                ? `× normal lifestyle (×${ex.mNormal.toFixed(2)}) = ${ex.normal.mid} sessions`
                : `× Lifestyle normal (×${ex.mNormal.toFixed(2)}) = ${ex.normal.mid} Sitzungen`,
            en
                ? `× poor lifestyle (×${ex.mPoor.toFixed(2)}) = ${ex.poor.rawMid} → ${ex.poor.mid} sessions`
                : `× Lifestyle schlecht (×${ex.mPoor.toFixed(2)}) = ${ex.poor.rawMid} → ${ex.poor.mid} Sitzungen`,
            en
                ? `× very poor lifestyle (×${ex.mVeryPoor.toFixed(2)}) = ${ex.veryPoor.rawMid} → ${ex.veryPoor.mid} sessions`
                : `× Lifestyle sehr schlecht (×${ex.mVeryPoor.toFixed(2)}) = ${ex.veryPoor.rawMid} → ${ex.veryPoor.mid} Sitzungen`,
        ],
        conclusionLines: [
            en
                ? `→ At a normal lifestyle: +${ex.plusOneNormal.mid - ex.normal.mid} session`
                : `→ Bei normalem Lifestyle: +${ex.plusOneNormal.mid - ex.normal.mid} Sitzung mehr`,
            en
                ? `→ At a poor lifestyle (×${ex.mPoor.toFixed(2)}): about +${(ex.plusOnePoor.rawMid - ex.poor.rawMid).toFixed(1)} sessions`
                : `→ Bei schlechtem Lifestyle (×${ex.mPoor.toFixed(2)}): ca. +${(ex.plusOnePoor.rawMid - ex.poor.rawMid).toFixed(1)} Sitzungen mehr`,
            en
                ? `→ At a very poor lifestyle (×${ex.mVeryPoor.toFixed(2)}): about +${(ex.plusOneVeryPoor.rawMid - ex.veryPoor.rawMid).toFixed(1)} sessions`
                : `→ Bei sehr schlechtem Lifestyle (×${ex.mVeryPoor.toFixed(2)}): ca. +${(ex.plusOneVeryPoor.rawMid - ex.veryPoor.rawMid).toFixed(1)} Sitzungen mehr`,
        ],
    };

    copy.calc = {
        ...copy.calc,
        priceExample: [
            en
                ? `Tattoo area × CHF ${facts.price_per_cm2} = price`
                : `Tattoo-Fläche × CHF ${facts.price_per_cm2} = Preis`,
            en
                ? `Minimum price: CHF ${facts.min_price}`
                : `Mindestpreis: CHF ${facts.min_price}`,
            en
                ? `Example: ${ex.area} cm² × ${facts.price_per_cm2} = CHF ${fmtChf(ex.area * n(facts.price.basePricePerCm2, 3))}`
                : `Beispiel: ${ex.area} cm² × ${facts.price_per_cm2} = CHF ${fmtChf(ex.area * n(facts.price.basePricePerCm2, 3))}`,
        ],
        whatLines: [
            en ? '+ = more sessions needed' : '+ = mehr Sitzungen nötig',
            en ? '− = fewer sessions needed' : '− = weniger Sitzungen nötig',
            en ? '0 = no effect' : '0 = kein Einfluss',
        ],
        exampleLines: [
            en ? `Base: ${facts.base_sessions}` : `Basis: ${facts.base_sessions}`,
            en
                ? `Green (Δ${ex.green >= 0 ? '+' : ''}${ex.green}): ${ex.green >= 0 ? '+' : ''}${ex.green}`
                : `Grün (Δ${ex.green >= 0 ? '+' : ''}${ex.green}): ${ex.green >= 0 ? '+' : ''}${ex.green}`,
            en
                ? `Hand (Δ${ex.hand >= 0 ? '+' : ''}${ex.hand}): ${ex.hand >= 0 ? '+' : ''}${ex.hand}`
                : `Hand (Δ${ex.hand >= 0 ? '+' : ''}${ex.hand}): ${ex.hand >= 0 ? '+' : ''}${ex.hand}`,
            en
                ? `Lifestyle poor: ×${ex.mPoor.toFixed(2)}`
                : `Lifestyle schlecht: ×${ex.mPoor.toFixed(2)}`,
            `(${facts.base_sessions}+${ex.tattooDelta}) × ${ex.mPoor.toFixed(2)} = ${ex.poor.rawMid} → ${ex.poor.mid} ${en ? 'sessions' : 'Sitzungen'}`,
            en
                ? `Range: ${ex.poor.min}–${ex.poor.max} sessions`
                : `Range: ${ex.poor.min}–${ex.poor.max} Sitzungen`,
        ],
        costText: en
            ? `CHF ${fmtChf(ex.pricePerSession)} × ${ex.normal.min}–${ex.normal.max} = CHF ${fmtChf(ex.pricePerSession * ex.normal.min)}–${fmtChf(ex.pricePerSession * ex.normal.max)}`
            : `CHF ${fmtChf(ex.pricePerSession)} × ${ex.normal.min}–${ex.normal.max} = CHF ${fmtChf(ex.pricePerSession * ex.normal.min)}–${fmtChf(ex.pricePerSession * ex.normal.max)}`,
        effectLines: [
            en
                ? `→ The raw value rises from ${ex.raw} to ${ex.raw + 1}`
                : `→ Der Rohwert steigt von ${ex.raw} auf ${ex.raw + 1}`,
            en
                ? `→ × lifestyle ${ex.mNormal.toFixed(2)} = ${ex.plusOneNormal.mid} sessions`
                : `→ × Lifestyle ${ex.mNormal.toFixed(2)} = ${ex.plusOneNormal.mid} Sitzungen`,
            en
                ? `→ × lifestyle ${ex.mPoor.toFixed(2)} = ${ex.plusOnePoor.rawMid} → ${ex.plusOnePoor.mid} sessions`
                : `→ × Lifestyle ${ex.mPoor.toFixed(2)} = ${ex.plusOnePoor.rawMid} → ${ex.plusOnePoor.mid} Sitzungen`,
            en
                ? `→ × lifestyle ${ex.mVeryPoor.toFixed(2)} = ${ex.plusOneVeryPoor.rawMid} → ${ex.plusOneVeryPoor.mid} sessions`
                : `→ × Lifestyle ${ex.mVeryPoor.toFixed(2)} = ${ex.plusOneVeryPoor.rawMid} → ${ex.plusOneVeryPoor.mid} Sitzungen`,
        ],
    };

    copy.lifestyle = {
        ...copy.lifestyle,
        bands: facts.bands,
        exampleLines: [
            en
                ? 'Customer smokes daily (score 5) + sleeps well (score 2)'
                : 'Kunde raucht täglich (Score 5) + schläft gut (Score 2)',
            en
                ? '+ no sport (score 4) + normal stress (score 2)'
                : '+ kein Sport (Score 4) + normaler Stress (Score 2)',
            en
                ? 'Average: (5+2+4+2) / 4 = 3.25 → looked up against the thresholds above'
                : 'Durchschnitt: (5+2+4+2) / 4 = 3.25 → nachgeschlagen in den Schwellen oben',
        ],
    };

    return copy;
};

const compactDeltaMaps = (session) => ({
    tattoo_deltas: session.tattoo_deltas || {},
    lifestyle_scores: session.lifestyle_scores || {},
    lifestyle_bands: session.lifestyle_bands || [],
    lifestyle_bmi_floors: session.lifestyle_bmi_floors || [],
    aftercare_extra_max: session.aftercare_extra_max || {},
    base_sessions: session.base_sessions,
    min_sessions: session.min_sessions,
    max_sessions: session.max_sessions,
    range_minus: session.range_minus,
    range_plus: session.range_plus,
    color_aggregation: session.color_aggregation || 'max',
    treatment_key: session.treatment_key || 'tattoo',
});

/**
 * Compact published Engine snapshot for ELAYA Chat / AI Training Center.
 * Studio/admin get full delta maps. Customer gets the explanation only.
 */
const formatEngineSnapshotForAi = ({
    lang = 'de',
    sessionPrediction,
    pricing,
    explainer,
    versions = {},
    includeDeltas = false,
}) => {
    const facts = buildEngineFacts(sessionPrediction, pricing, lang);
    const view = buildHowItWorksView(facts, explainer, lang);
    const en = lang === 'en';
    const header = en
        ? `PUBLISHED ELAYA ENGINE (source of truth)\nsession_prediction v${versions.session_prediction || 0} · default_pricing v${versions.default_pricing || 0} · engine_explainer v${versions.engine_explainer || 0}`
        : `VERÖFFENTLICHTE ELAYA-ENGINE (Quelle der Wahrheit)\nsession_prediction v${versions.session_prediction || 0} · default_pricing v${versions.default_pricing || 0} · engine_explainer v${versions.engine_explainer || 0}`;

    const formula = en
        ? [
              `Session formula: (base ${facts.base_sessions} + tattoo deltas) × lifestyle multiplier → rounded centre, clamped ${facts.min_sessions}–${facts.max_sessions}. Range = centre − ${facts.range_minus} / + ${facts.range_plus}.`,
              `Price formula: MAX(${facts.min_price} CHF, area × ${facts.price_per_cm2} CHF), rounded up to CHF ${facts.price_round_to}. Colours do not change price.`,
              `Colour aggregation: ${facts.color_aggregation_rule}.`,
              `Live vs Draft: Chat always uses published Live. Draft changes are invisible to Chat until Publish.`,
          ].join('\n')
        : [
              `Sitzungsformel: (Basis ${facts.base_sessions} + Tattoo-Deltas) × Lifestyle-Multiplikator → gerundete Mitte, begrenzt ${facts.min_sessions}–${facts.max_sessions}. Range = Mitte − ${facts.range_minus} / + ${facts.range_plus}.`,
              `Preisformel: MAX(${facts.min_price} CHF, Fläche × ${facts.price_per_cm2} CHF), aufgerundet auf CHF ${facts.price_round_to}. Farben ändern den Preis nicht.`,
              `Farb-Aggregation: ${facts.color_aggregation_rule}.`,
              `Live vs Draft: Chat verwendet immer das veröffentlichte Live. Draft-Änderungen sind für Chat unsichtbar, bis veröffentlicht wird.`,
          ].join('\n');

    const explanation = [
        view.liveDraft?.liveText,
        view.calc?.sessionsText,
        view.calc?.priceRule,
        view.calc?.colorImpact,
        view.aiText,
    ]
        .filter(Boolean)
        .join('\n');

    let body = `${header}\n\n${formula}\n\n${explanation}`;
    if (includeDeltas) {
        body += `\n\n${en ? 'PUBLISHED DELTA MAPS' : 'VERÖFFENTLICHTE DELTA-WERTE'}:\n${JSON.stringify(compactDeltaMaps(facts.session), null, 2)}`;
    }
    return body;
};

const loadPublishedEngineSnapshotForAi = async ({ lang = 'de', includeDeltas = false } = {}) => {
    const { getPlatformConfig, getPlatformConfigDoc, mergeDefaultPricing } = require('./configService');
    const platform = await getPlatformConfig();
    const doc = await getPlatformConfigDoc();
    return formatEngineSnapshotForAi({
        lang,
        sessionPrediction: platform.session_prediction,
        pricing: mergeDefaultPricing(platform),
        explainer: platform.engine_explainer,
        versions: doc.current_versions || {},
        includeDeltas,
    });
};

module.exports = {
    buildEngineFacts,
    interpolateExplainer,
    buildHowItWorksView,
    formatEngineSnapshotForAi,
    loadPublishedEngineSnapshotForAi,
    fillDeep,
};

/**
 * Healing logic — Master Excel IT_Clarifications §6 R6 + §9
 * and HealingLogic_Master / Aftercare_Symptoms / Behavior_Since_Treatment.
 *
 * Time windows: days 1–7 early, 8–21 healing, >21 consolidation.
 * Assessment always combines window + symptom type/severity + progress.
 * Delayed is never date-only. Red flags override the window.
 *
 * Status: normal | monitor | conspicuous | delayed
 * Customers get understandable copy, not a medical diagnosis.
 */

const LEVEL_SCORE = {
    none: 0,
    mild: 1,
    moderate: 2,
    severe: 3,
};

const LEGACY_SYMPTOM_MAP = {
    roetung: 'erythema',
    redness: 'erythema',
    erythema: 'erythema',
    schwellung: 'swelling',
    swelling: 'swelling',
    blaeschen: 'blistering',
    blasen: 'blistering',
    blister: 'blistering',
    blistering: 'blistering',
    schmerzen: 'pain',
    pain: 'pain',
    juckreiz: 'itching',
    itching: 'itching',
    krusten: 'crusting',
    crusting: 'crusting',
    naessen: 'oozing',
    oozing: 'oozing',
    waerme: 'warmth',
    warmth: 'warmth',
    infektion: 'infection',
    infection: 'infection',
    hyperpig: 'hyperpigmentation',
    hypopig: 'hypopigmentation',
    open_lesion: 'open_lesion',
    offen: 'open_lesion',
};

const scoreLevel = (value) => {
    if (value == null || value === '') return 0;
    if (typeof value === 'boolean') return value ? 3 : 0;
    const n = Number(value);
    if (Number.isFinite(n) && (value === n || String(value) === String(n))) {
        return n;
    }
    return LEVEL_SCORE[String(value).toLowerCase()] ?? 0;
};

const resolvePhase = (days) => {
    if (days == null || !Number.isFinite(Number(days))) {
        return { phase: 'unknown', days: null };
    }
    const n = Math.max(0, Math.floor(Number(days)));
    if (n <= 7) return { phase: 'early', days: n };
    if (n <= 21) return { phase: 'healing', days: n };
    return { phase: 'consolidation', days: n };
};

const mapLegacySymptoms = (list = []) => {
    const keys = (Array.isArray(list) ? list : []).map((item) =>
        String(item || '')
            .toLowerCase()
            .trim()
    );
    const mapped = {
        erythema_level: 'none',
        swelling_level: 'none',
        blistering_flag: false,
        crusting_level: 'none',
        pain_score: 0,
        itching_level: 'none',
        hyperpigmentation_level: 'none',
        hypopigmentation_level: 'none',
        infection_suspected: false,
        oozing: false,
        warmth: false,
        open_lesion: false,
    };

    for (const key of keys) {
        if (!key || key === 'keine' || key === 'none') continue;
        const field = LEGACY_SYMPTOM_MAP[key];
        if (field === 'erythema') mapped.erythema_level = 'moderate';
        else if (field === 'swelling') mapped.swelling_level = 'moderate';
        else if (field === 'blistering') mapped.blistering_flag = true;
        else if (field === 'pain') mapped.pain_score = Math.max(mapped.pain_score, 6);
        else if (field === 'itching') mapped.itching_level = 'moderate';
        else if (field === 'crusting') mapped.crusting_level = 'moderate';
        else if (field === 'oozing') {
            mapped.oozing = true;
            mapped.open_lesion = true;
        } else if (field === 'warmth') {
            mapped.warmth = true;
        } else if (field === 'infection') mapped.infection_suspected = true;
        else if (field === 'hyperpigmentation') mapped.hyperpigmentation_level = 'moderate';
        else if (field === 'hypopigmentation') mapped.hypopigmentation_level = 'moderate';
        else if (field === 'open_lesion') mapped.open_lesion = true;
    }

    return mapped;
};

const mergeSymptoms = (input = {}) => {
    const fromList = mapLegacySymptoms(input.symptome);
    const pick = (key, fallback) =>
        input[key] != null && input[key] !== '' ? input[key] : fromList[key] ?? fallback;

    return {
        erythema_level: pick('erythema_level', 'none'),
        swelling_level: pick('swelling_level', 'none'),
        blistering_flag: Boolean(pick('blistering_flag', false)),
        crusting_level: pick('crusting_level', 'none'),
        pain_score: Number(pick('pain_score', 0)) || 0,
        itching_level: pick('itching_level', 'none'),
        hyperpigmentation_level: pick('hyperpigmentation_level', 'none'),
        hypopigmentation_level: pick('hypopigmentation_level', 'none'),
        infection_suspected: Boolean(pick('infection_suspected', false)),
        oozing: Boolean(pick('oozing', false)),
        warmth: Boolean(pick('warmth', false)),
        open_lesion: Boolean(pick('open_lesion', false) || pick('oozing', false)),
        progress_direction_self: input.progress_direction_self || null,
        concern_flag: input.concern_flag === true,
        sun_avoidance: input.sun_avoidance || null,
        spf_use: input.spf_use || null,
        aftercare_use: input.aftercare_use || null,
        scratching_behavior: input.scratching_behavior || null,
        early_sport_flag: input.early_sport_flag || null,
        current_sleep_quality: input.current_sleep_quality || null,
        current_stress_level: input.current_stress_level || null,
        current_hydration_level: input.current_hydration_level || null,
        recent_alcohol_excess: input.recent_alcohol_excess || null,
    };
};

/** HealingLogic_Master: crusting 0–3 with day-window modulation. */
const crustingContribution = (crusting, phase) => {
    if (phase === 'early') {
        return crusting >= 3 ? 3 : 0;
    }
    if (phase === 'healing') {
        return crusting;
    }
    return crusting >= 1 ? crusting + 1 : 0;
};

/** Sun/UV 0–2 from sun_avoidance + spf_use. */
const sunScore = (symptoms) => {
    const sun = { yes: 0, mostly: 0, partly: 1, no: 2 }[symptoms.sun_avoidance] ?? 0;
    const spf = { yes: 0, mostly: 0, partly: 1, no: 1 }[symptoms.spf_use] ?? 0;
    return Math.min(2, sun + (symptoms.sun_avoidance === 'no' ? 0 : spf));
};

/** Aftercare compliance 0–3 from products + scratching. */
const aftercareScore = (symptoms) => {
    const use = { yes: 0, mostly: 0, partly: 2, no: 3 }[symptoms.aftercare_use] ?? 0;
    const scratch = { no: 0, slightly: 1, often: 3 }[symptoms.scratching_behavior] ?? 0;
    return Math.min(3, Math.max(use, scratch));
};

/** Sleep + stress modulator 0–2. */
const sleepStressScore = (symptoms) => {
    const sleep = { excellent: 0, good: 0, fair: 1, poor: 2 }[symptoms.current_sleep_quality] ?? 0;
    const stress = { low: 0, medium: 0, high: 1, very_high: 2 }[symptoms.current_stress_level] ?? 0;
    return Math.min(2, Math.round((sleep + stress) / 1.5));
};

/** Hydration + alcohol modulator 0–2. */
const hydrationAlcoholScore = (symptoms) => {
    const hydra = { good: 0, normal: 0, low: 1 }[symptoms.current_hydration_level] ?? 0;
    const alcohol = { no: 0, slightly: 1, yes: 2 }[symptoms.recent_alcohol_excess] ?? 0;
    return Math.min(2, hydra + alcohol);
};

const behaviorBreakdown = (symptoms) => {
    const sun = sunScore(symptoms);
    const aftercare = aftercareScore(symptoms);
    const sleepStress = sleepStressScore(symptoms);
    const hydrationAlcohol = hydrationAlcoholScore(symptoms);
    const sport = symptoms.early_sport_flag === 'yes' ? 1 : 0;
    return {
        sun,
        aftercare,
        sleep_stress: sleepStress,
        hydration_alcohol: hydrationAlcohol,
        early_sport: sport,
        total: sun + aftercare + sleepStress + hydrationAlcohol + sport,
    };
};

const STATUS_TO_AMPEL = {
    normal: 'gruen',
    monitor: 'orange',
    delayed: 'orange',
    conspicuous: 'rot',
};

const CUSTOMER_COPY = {
    early: {
        normal: 'Frühe Heilungsphase — milde Reaktionen können jetzt noch normal sein.',
        monitor: 'Frühe Heilungsphase — bitte die Stelle weiter beobachten.',
        conspicuous: 'Auffällige Symptome. Bitte das Studio kontaktieren. Dies ist keine medizinische Diagnose.',
        delayed: 'Die Heilung wirkt verzögert. Bitte das Studio kontaktieren. Dies ist keine medizinische Diagnose.',
    },
    healing: {
        normal: 'Heilungsphase — die Beschwerden sollten jetzt eher abnehmen.',
        monitor: 'Heilungsphase — unveränderte oder zunehmende Beschwerden bitte beobachten und dem Studio zeigen.',
        conspicuous: 'Auffällige Symptome in der Heilungsphase. Bitte das Studio kontaktieren. Dies ist keine medizinische Diagnose.',
        delayed: 'Die Heilung wirkt verzögert. Bitte das Studio kontaktieren. Dies ist keine medizinische Diagnose.',
    },
    consolidation: {
        normal: 'Konsolidierungsphase — der Verlauf wirkt unauffällig.',
        monitor: 'Konsolidierungsphase — bitte weiter beobachten und dem Studio Bescheid geben, falls es nicht besser wird.',
        conspicuous: 'Auffällige Symptome nach mehr als 21 Tagen. Bitte das Studio kontaktieren. Dies ist keine medizinische Diagnose.',
        delayed: 'Anhaltende Beschwerden nach mehr als 21 Tagen können auf eine verzögerte Heilung hinweisen. Bitte das Studio kontaktieren. Dies ist keine medizinische Diagnose.',
    },
    unknown: {
        normal: 'Der Heilungsverlauf wirkt derzeit unauffällig.',
        monitor: 'Bitte die behandelte Stelle weiter beobachten.',
        conspicuous: 'Auffällige Symptome. Bitte das Studio kontaktieren. Dies ist keine medizinische Diagnose.',
        delayed: 'Die Heilung wirkt verzögert. Bitte das Studio kontaktieren. Dies ist keine medizinische Diagnose.',
    },
};

const ACTION_COPY = {
    continue_aftercare: 'Nachsorge wie empfohlen fortsetzen.',
    continue_monitoring: 'Stelle weiter beobachten und bei Verschlechterung das Studio informieren.',
    photo_again: 'In ein paar Tagen ein neues Fortschrittsfoto machen.',
    check_studio: 'Bitte das Studio kontaktieren. Dies ersetzt keine ärztliche Diagnose.',
};

const computeHealingAssessment = (input = {}) => {
    const { phase, days } = resolvePhase(input.days_since_session);
    const symptoms = mergeSymptoms(input);

    const erythema = scoreLevel(symptoms.erythema_level);
    const swelling = scoreLevel(symptoms.swelling_level);
    const crusting = scoreLevel(symptoms.crusting_level);
    const itching = scoreLevel(symptoms.itching_level);
    const hyper = scoreLevel(symptoms.hyperpigmentation_level);
    const hypo = scoreLevel(symptoms.hypopigmentation_level);
    const pain = Math.max(0, Math.min(10, Number(symptoms.pain_score) || 0));
    const painBand = pain >= 8 ? 3 : pain >= 5 ? 2 : pain >= 3 ? 1 : 0;

    const safetyFlags = [];
    if (symptoms.blistering_flag) safetyFlags.push('blistering');
    if (pain >= 8) safetyFlags.push('high_pain');
    if (symptoms.infection_suspected) safetyFlags.push('infection_suspected');
    if (erythema >= 3) safetyFlags.push('severe_erythema');
    if (swelling >= 3) safetyFlags.push('severe_swelling');
    if (symptoms.oozing || symptoms.open_lesion) safetyFlags.push('open_lesion');
    if (input.photo_ampel === 'rot') safetyFlags.push('photo_red');

    const riskFlags = [];
    if (hyper >= 3 || (hyper >= 2 && phase !== 'early')) riskFlags.push('hyperpigmentation');
    if (hypo >= 3 || (hypo >= 2 && phase !== 'early')) riskFlags.push('hypopigmentation');
    if (phase !== 'early' && crusting >= 2) riskFlags.push('crusting_outside_window');
    if (symptoms.warmth && phase !== 'early') riskFlags.push('warmth_late');

    const behavior = behaviorBreakdown(symptoms);
    if (behavior.sun >= 2) riskFlags.push('sun_exposure');
    if (behavior.aftercare >= 3) riskFlags.push('poor_aftercare');
    if (sleepStressScore(symptoms) >= 2) riskFlags.push('poor_sleep_high_stress');
    if (hydrationAlcoholScore(symptoms) >= 2) riskFlags.push('low_hydration_alcohol');

    const symptomLoad =
        erythema +
        swelling +
        crustingContribution(crusting, phase) +
        itching +
        (symptoms.blistering_flag ? 3 : 0) +
        painBand +
        (symptoms.oozing || symptoms.open_lesion ? 3 : 0) +
        (symptoms.warmth ? 1 : 0);

    const worse = symptoms.progress_direction_self === 'worse';
    const unchanged = symptoms.progress_direction_self === 'same';
    const better = symptoms.progress_direction_self === 'better';
    const concern = symptoms.progress_direction_self === 'unclear' || symptoms.concern_flag;

    let status = 'normal';

    if (safetyFlags.length) {
        status = 'conspicuous';
    } else if (phase === 'early') {
        // Mild–moderate acute reactions can still be normal.
        if (worse || painBand >= 2 || symptomLoad >= 9) status = 'monitor';
        else status = 'normal';
    } else if (phase === 'healing') {
        if (symptomLoad >= 8 || (worse && symptomLoad >= 4)) status = 'conspicuous';
        else if (worse || (unchanged && symptomLoad >= 3) || symptomLoad >= 6) status = 'monitor';
        else if (better && symptomLoad <= 3) status = 'normal';
        else if (symptomLoad >= 4) status = 'monitor';
    } else if (phase === 'consolidation') {
        const persistent =
            symptomLoad >= 3 ||
            crusting >= 2 ||
            symptoms.open_lesion ||
            ((unchanged || worse) && symptomLoad >= 1) ||
            pain >= 5;
        if (persistent) status = 'delayed';
        if (symptomLoad >= 6 || worse || safetyFlags.length) status = 'conspicuous';
    } else if (symptomLoad >= 6 || worse) {
        status = 'monitor';
    }

    if (behavior.total >= 4 && status === 'normal') status = 'monitor';
    if (concern && status === 'normal') status = 'monitor';
    if (input.photo_ampel === 'orange' && status === 'normal') status = 'monitor';
    if (riskFlags.includes('crusting_outside_window') && status === 'normal') status = 'monitor';

    const redFlags = [...safetyFlags, ...riskFlags];
    const clinicalReview =
        status === 'conspicuous' ||
        status === 'delayed' ||
        safetyFlags.length > 0 ||
        riskFlags.length > 0 ||
        symptoms.blistering_flag ||
        pain >= 8 ||
        (worse && phase !== 'early');
    const emptyWindowReview = phase === 'unknown';
    const needs_human_review = clinicalReview || emptyWindowReview;

    const severity_score = symptomLoad + behavior.total;
    const healing_progress_score = Math.max(0, Math.min(100, 100 - severity_score * 7));

    let recommended_action = 'continue_aftercare';
    if (clinicalReview || status === 'conspicuous' || status === 'delayed') {
        recommended_action = 'check_studio';
    } else if (status === 'monitor' && phase === 'healing' && (unchanged || worse)) {
        recommended_action = 'photo_again';
    } else if (status === 'monitor') {
        recommended_action = 'continue_monitoring';
    }

    const copySet = CUSTOMER_COPY[phase] || CUSTOMER_COPY.unknown;

    return {
        healing_status: status,
        healing_phase: phase,
        days_since_session: days,
        severity_score,
        healing_progress_score,
        red_flag: redFlags.length > 0,
        red_flags: redFlags,
        safety_flags: safetyFlags,
        risk_flags: riskFlags,
        needs_human_review,
        ampel: STATUS_TO_AMPEL[status] || 'orange',
        studio_kontakt: clinicalReview,
        symptoms,
        behavior,
        customer_summary: copySet[status] || copySet.monitor,
        recommended_action,
        recommended_action_text: ACTION_COPY[recommended_action],
        review_triggers: emptyWindowReview
            ? [...redFlags, 'unknown_healing_window']
            : redFlags,
    };
};

const applyStudioHealingCorrection = (current = {}, healingStatus) => {
    const status = healingStatus || current.healing_status || 'monitor';
    const phase = current.healing_phase || 'unknown';
    const copySet = CUSTOMER_COPY[phase] || CUSTOMER_COPY.unknown;
    let recommended_action = 'continue_aftercare';
    if (status === 'conspicuous' || status === 'delayed') recommended_action = 'check_studio';
    else if (status === 'monitor') recommended_action = 'continue_monitoring';

    return {
        healing_status: status,
        ampel: STATUS_TO_AMPEL[status] || 'orange',
        studio_kontakt: status === 'conspicuous' || status === 'delayed',
        healing_needs_review: false,
        customer_summary: copySet[status] || copySet.monitor,
        recommended_action,
        recommended_action_text: ACTION_COPY[recommended_action],
    };
};

const ampelRank = { gruen: 0, orange: 1, rot: 2 };

const worseAmpel = (a, b) => {
    const left = ampelRank[a] ?? 1;
    const right = ampelRank[b] ?? 1;
    return left >= right ? a : b;
};

module.exports = {
    computeHealingAssessment,
    applyStudioHealingCorrection,
    mapLegacySymptoms,
    mergeSymptoms,
    resolvePhase,
    worseAmpel,
    ACTION_COPY,
    STATUS_TO_AMPEL,
};

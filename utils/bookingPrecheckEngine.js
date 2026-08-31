const {
    normalizePreSessionCheck,
    computeAvailability,
    startOfDay,
    resolveSperrfristen,
} = require('./lockoutEngine');
const { computeAmpel } = require('./anamnesisEngine');

const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    d.setHours(0, 0, 0, 0);
    return d;
};

/** KO fields re-asked at booking when originally flagged in anamnesis. */
const KO_RECHECKS = [
    {
        frage_key: 'mindestalter_18',
        frage_nr: 19,
        frage_text: 'Mindestalter 18',
        trigger: (a) => a.mindestalter_18 === 'nein',
        permanent: true,
        options: [],
    },
    {
        frage_key: 'schwanger',
        frage_nr: 16,
        frage_text: 'Schwangerschaft / Stillzeit',
        trigger: (a) => a.schwanger === 'ja',
        cleared_value: 'nein',
        options: [
            { value: 'changed', label_de: 'Ja, nicht mehr schwanger/stillend' },
            { value: 'still', label_de: 'Nein, bin noch schwanger/stillend' },
        ],
    },
    {
        frage_key: 'akute_erkrankung',
        frage_nr: 3,
        frage_text: 'Akute Erkrankung',
        trigger: (a) => a.akute_erkrankung === 'ja',
        cleared_value: 'nein',
        options: [
            { value: 'changed', label_de: 'Ja, bin genesen' },
            { value: 'still', label_de: 'Nein, bin noch krank' },
        ],
    },
    {
        frage_key: 'alkohol_drogen',
        frage_nr: 17,
        frage_text: 'Alkohol / Drogen',
        trigger: (a) => a.alkohol_drogen === 'ja',
        cleared_value: 'nein',
        options: [
            { value: 'changed', label_de: 'Nein, nicht mehr' },
            { value: 'still', label_de: 'Ja, stimmt noch' },
        ],
    },
    {
        frage_key: 'urteilsfaehig',
        frage_nr: 18,
        frage_text: 'Urteilsfähigkeit',
        trigger: (a) => a.urteilsfaehig === 'nein',
        cleared_value: 'ja',
        options: [
            { value: 'changed', label_de: 'Ja, bin jetzt urteilsfähig' },
            { value: 'still', label_de: 'Nein, stimmt noch' },
        ],
    },
];

/**
 * Option catalogues carry the studio's configured `lock_days`, which is what the
 * clients render — they never hold their own copy of the durations.
 */
const medicationGroups = (sperrfristen) => {
    const cfg = resolveSperrfristen(sperrfristen);
    return [
        { key: 'keine', label_de: 'Keine / keine Medikamente', label_en: 'None / no medications', lock_days: 0 },
        { key: 'antibiotika', label_de: 'Antibiotika', label_en: 'Antibiotics', lock_days: cfg.medikament_kurz_tage },
        {
            key: 'antidepressiva',
            label_de: 'Antidepressiva',
            label_en: 'Antidepressants',
            lock_days: cfg.medikament_kurz_tage,
        },
        { key: 'retinoide', label_de: 'Retinoide', label_en: 'Retinoids', lock_days: cfg.medikament_retinoide_tage },
    ];
};

const uvOptions = (sperrfristen) => {
    const cfg = resolveSperrfristen(sperrfristen);
    return [
        { value: 'keine', label_de: 'Keine', label_en: 'None', lock_days: 0 },
        { value: 'leicht', label_de: 'Leicht', label_en: 'Light', lock_days: 0 },
        { value: 'mittel', label_de: 'Mittel', label_en: 'Moderate', lock_days: cfg.uv_mittel_tage },
        { value: 'intensiv', label_de: 'Intensiv', label_en: 'Intense', lock_days: cfg.uv_intensiv_tage },
    ];
};

const CLARIFICATION_MESSAGE = {
    code: 'studio_clarification_required',
    message_de:
        'Medizinische Abklärung durch das Studio ist erforderlich. Du kannst den Termin trotzdem buchen — das Studio kontaktiert dich vor der Behandlung und trifft die endgültige Entscheidung.',
    message_en:
        'Medical/studio clarification is required. You can still book — the studio will contact you before treatment and make the final decision.',
};

const BLOCK_MESSAGES = {
    mindestalter_18: {
        code: 'ko_permanent',
        message_de: 'Die Behandlung ist erst ab 18 Jahren möglich. Bitte kontaktiere das Studio.',
    },
    studio_clarification: CLARIFICATION_MESSAGE,
    pre_session_incomplete: {
        code: 'pre_session_incomplete',
        message_de: 'Bitte beantworte alle Pflichtfragen im Kurz-Check.',
    },
    wiederholungen_incomplete: {
        code: 'wiederholungen_incomplete',
        message_de: 'Bitte bestätige alle Rückfragen zur Anamnese.',
    },
    ko_signature_required: {
        code: 'ko_signature_required',
        message_de: 'Bitte unterschreibe zur Bestätigung deiner geänderten Angaben.',
    },
    anamnesis_required: {
        code: 'anamnesis_required',
        message_de: 'Bitte schliesse zuerst die medizinische Anamnese ab.',
    },
};

const lookupWiederholung = (wiederholungen = {}, frage = {}) => {
    if (!wiederholungen || typeof wiederholungen !== 'object') return null;
    const candidates = [
        frage.frage_key,
        frage.frage_key != null ? String(frage.frage_key) : null,
        frage.frage_nr != null ? String(frage.frage_nr) : null,
        frage.frage_nr,
        frage.frage_nr != null ? `F${frage.frage_nr}` : null,
    ].filter((key) => key !== null && key !== undefined && key !== '');

    for (const key of candidates) {
        if (wiederholungen[key] != null) return wiederholungen[key];
    }

    const lower = String(frage.frage_key || '').toLowerCase();
    if (lower) {
        for (const [key, value] of Object.entries(wiederholungen)) {
            if (String(key).toLowerCase() === lower) return value;
        }
    }
    return null;
};

const parseAktuellGleich = (ans) => {
    if (ans == null || typeof ans !== 'object') return { ok: false, value: null, aenderung: '' };
    const raw = ans.aktuell_gleich;
    if (typeof raw === 'boolean') {
        return { ok: true, value: raw, aenderung: ans.aenderung || '' };
    }
    if (raw === 1 || raw === '1' || raw === 'true' || raw === 'yes' || raw === 'ja') {
        return { ok: true, value: true, aenderung: ans.aenderung || '' };
    }
    if (raw === 0 || raw === '0' || raw === 'false' || raw === 'no' || raw === 'nein') {
        return { ok: true, value: false, aenderung: ans.aenderung || '' };
    }
    return { ok: false, value: null, aenderung: ans.aenderung || '' };
};

const KO_RECOVERY_LABELS = {
    schwanger: { original: 'Schwanger/stillend', neu: 'Nicht mehr schwanger/stillend' },
    akute_erkrankung: { original: 'Akut krank', neu: 'Von akuter Erkrankung genesen' },
    alkohol_drogen: { original: 'Unter Einfluss', neu: 'Nicht mehr unter Einfluss' },
    urteilsfaehig: { original: 'Nicht urteilsfähig', neu: 'Urteilsfähigkeit wiederhergestellt' },
};

const collectRecoveryKeys = (answers = {}, koAnswers = {}, wiederholungen = {}) => {
    const keys = [];
    for (const def of KO_RECHECKS) {
        if (def.permanent || !def.trigger(answers)) continue;
        if (koAnswers[def.frage_key] === 'changed') {
            keys.push(def.frage_key);
            continue;
        }
        const parsed = parseAktuellGleich(lookupWiederholung(wiederholungen, def));
        if (parsed.ok && parsed.value === false) {
            keys.push(def.frage_key);
        }
    }
    return keys;
};

const mergeRecoveryKoAnswers = (answers, koAnswers, wiederholungen) => {
    const merged = { ...(koAnswers || {}) };
    for (const key of collectRecoveryKeys(answers, koAnswers, wiederholungen)) {
        if (!merged[key]) merged[key] = 'changed';
    }
    return merged;
};

const clarificationWarning = (frageKey, frageText) => ({
    ...CLARIFICATION_MESSAGE,
    frage_key: frageKey || null,
    frage_text: frageText || '',
});

const buildKoRechecks = (answers = {}) =>
    KO_RECHECKS.filter((def) => def.trigger(answers)).map((def) => ({
        frage_key: def.frage_key,
        frage_nr: def.frage_nr,
        frage_text: def.frage_text,
        original_antwort: answers[def.frage_key] ?? null,
        permanent: def.permanent === true,
        options: def.options,
    }));

const buildRoteFragenRechecks = (roteFragen = []) =>
    roteFragen.map((f) => ({
        frage_nr: f.frage_nr,
        frage_key: f.frage_key,
        frage_text: f.frage_text,
        antwort: f.antwort,
    }));

const buildPrerequisites = (caseDoc) => {
    const anamnesisComplete = caseDoc.anamnesis_complete === true;
    const signatureComplete = !!caseDoc.unterschrift?.zeitstempel;
    const blockReason = !anamnesisComplete ? BLOCK_MESSAGES.anamnesis_required.message_de : null;

    return {
        anamnesis_complete: anamnesisComplete,
        signature_complete: signatureComplete,
        can_book_treatment: anamnesisComplete,
        block_reason: blockReason,
    };
};

const buildBookingPrecheckForm = (caseDoc, anamnesis, sperrfristen = null) => {
    const answers = anamnesis?.antworten || {};
    const ampel = computeAmpel(answers);

    return {
        /** Studio-configured blocking periods, so the client never assumes any. */
        sperrfristen: resolveSperrfristen(sperrfristen),
        case_id: caseDoc._id.toString(),
        consultation_only_skips_ps01: true,
        prerequisites: buildPrerequisites(caseDoc),
        ps01: {
            title: 'Kurz-Check vor dem Termin',
            subtitle: 'Dauert nur 30 Sekunden. Pflicht vor jeder Behandlung.',
            uv_options: uvOptions(sperrfristen),
            medication_question:
                'Hast du in den letzten 6 Monaten Medikamente eingenommen?',
            medication_question_en:
                'Have you taken any medications in the last 6 months?',
            medication_groups: medicationGroups(sperrfristen),
            ko_rechecks: buildKoRechecks(answers),
            rote_fragen_rechecks: buildRoteFragenRechecks(ampel.rote_fragen),
            requires_wiederholungen_confirm: ampel.rote_fragen.length > 0,
        },
    };
};

const REAL_MED_KEYS = new Set(['antibiotika', 'antidepressiva', 'retinoide']);

const toDateKey = (date) => {
    const d = startOfDay(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
};

const hasExplicitNoMeds = (rawMeds = []) =>
    rawMeds.includes('keine') && !rawMeds.some((m) => REAL_MED_KEYS.has(m));

const realMedications = (rawMeds = []) =>
    rawMeds.filter((m) => REAL_MED_KEYS.has(m));

const isPreSessionComplete = (preSession = {}) => {
    const rawMeds = Array.isArray(preSession.medikamente)
        ? preSession.medikamente.filter(Boolean)
        : [];
    const check = normalizePreSessionCheck(preSession);
    const uvOk = !!check.uv_exposition;
    const none = hasExplicitNoMeds(rawMeds);
    const meds = realMedications(rawMeds);
    const medOk = none || (meds.length > 0 && !!check.medikament_datum);
    return uvOk && medOk;
};

const formatNotice = ({ source, days, earliest, active, label_de, label_en }) => {
    if (!active) {
        return {
            source,
            days,
            earliest: null,
            active: false,
            message_de: `Keine aktive Sperrfrist für ${label_de}.`,
            message_en: `No active blocking period for ${label_en}.`,
        };
    }
    return {
        source,
        days,
        earliest,
        active: true,
        message_de: `Sperrfrist ${days} Tage — Behandlung frühestens am ${earliest} buchbar.`,
        message_en: `Blocking period ${days} days — earliest treatment ${earliest}.`,
    };
};

/**
 * Immediate UV/medication lockout notices for the Quick Check UI.
 * Longest active lockout wins for earliest_bookable.
 */
const summarizePreSessionLockouts = (preSession = {}, now = new Date(), sperrfristen = null) => {
    const cfg = resolveSperrfristen(sperrfristen);
    const rawMeds = Array.isArray(preSession.medikamente)
        ? preSession.medikamente.filter(Boolean)
        : [];
    const check = normalizePreSessionCheck(preSession);
    const heute = startOfDay(now);
    const notices = [];

    if (check.uv_exposition === 'intensiv' || check.uv_exposition === 'mittel') {
        const days =
            check.uv_exposition === 'intensiv' ? cfg.uv_intensiv_tage : cfg.uv_mittel_tage;
        const until = addDays(heute, days);
        notices.push(
            formatNotice({
                source: 'uv',
                days,
                earliest: toDateKey(until),
                active: until > heute,
                label_de: check.uv_exposition === 'intensiv' ? 'intensive UV-Exposition' : 'mittlere UV-Exposition',
                label_en: check.uv_exposition === 'intensiv' ? 'intense UV exposure' : 'moderate UV exposure',
            })
        );
    }

    const meds = realMedications(rawMeds);
    const intakeDate = check.medikament_datum ? startOfDay(check.medikament_datum) : null;

    if (meds.length && intakeDate) {
        const groups = [
            {
                key: 'retinoide',
                days: cfg.medikament_retinoide_tage,
                label_de: 'Retinoide',
                label_en: 'retinoids',
            },
            {
                key: 'antibiotika',
                days: cfg.medikament_kurz_tage,
                label_de: 'Antibiotika',
                label_en: 'antibiotics',
            },
            {
                key: 'antidepressiva',
                days: cfg.medikament_kurz_tage,
                label_de: 'Antidepressiva',
                label_en: 'antidepressants',
            },
        ];
        for (const group of groups) {
            if (!meds.includes(group.key)) continue;
            const until = addDays(intakeDate, group.days);
            notices.push(
                formatNotice({
                    source: 'medication',
                    days: group.days,
                    earliest: toDateKey(until),
                    active: until > heute,
                    label_de: group.label_de,
                    label_en: group.label_en,
                })
            );
        }
    }

    const active = notices.filter((n) => n.active && n.earliest);
    active.sort((a, b) => String(a.earliest).localeCompare(String(b.earliest)));
    const earliest_bookable = active.length ? active[active.length - 1].earliest : null;

    return { notices, earliest_bookable };
};


const computeBlockDatesFromPreSession = (
    preSession = {},
    now = new Date(),
    sperrfristen = null
) => {
    const cfg = resolveSperrfristen(sperrfristen);
    const check = normalizePreSessionCheck(preSession);
    const heute = startOfDay(now);
    let uvBlockDate = null;
    let medicationBlockDate = null;

    if (check.uv_exposition === 'intensiv') {
        uvBlockDate = addDays(heute, cfg.uv_intensiv_tage);
    } else if (check.uv_exposition === 'mittel') {
        uvBlockDate = addDays(heute, cfg.uv_mittel_tage);
    }
    if (uvBlockDate && uvBlockDate <= heute) {
        uvBlockDate = null;
    }

    const meds = check.medikamente || [];
    const intakeDate = check.medikament_datum ? startOfDay(check.medikament_datum) : heute;
    let maxMedUntil = null;

    const applyMedUntil = (days) => {
        const until = addDays(intakeDate, days);
        if (!maxMedUntil || until > maxMedUntil) {
            maxMedUntil = until;
        }
    };

    if (meds.includes('retinoide')) applyMedUntil(cfg.medikament_retinoide_tage);
    if (meds.includes('antibiotika')) applyMedUntil(cfg.medikament_kurz_tage);
    if (meds.includes('antidepressiva')) applyMedUntil(cfg.medikament_kurz_tage);

    if (maxMedUntil && maxMedUntil > heute) {
        medicationBlockDate = maxMedUntil;
    }

    return { uvBlockDate, medicationBlockDate, preSessionCheck: check };
};

const validateBookingPrecheck = ({
    caseDoc,
    anamnesis,
    consultationOnly = false,
    preSession = {},
    koAnswers = {},
    wiederholungen = {},
    wiederholungenConfirmed = false,
    koSignature = null,
    sperrfristen = null,
}) => {
    if (consultationOnly) {
        return {
            can_proceed: true,
            blocks: [],
            warnings: [],
            requires_ko_signature: false,
            pre_session_check: {},
            block_dates: { uvBlockDate: null, medicationBlockDate: null },
            lockouts: { notices: [], earliest_bookable: null },
        };
    }

    const blocks = [];
    const warnings = [];
    const answers = anamnesis?.antworten || {};
    const ampel = computeAmpel(answers);
    const koRechecks = buildKoRechecks(answers);
    const roteFragen = ampel.rote_fragen;
    const effectiveKoAnswers = mergeRecoveryKoAnswers(answers, koAnswers, wiederholungen);

    if (!caseDoc.anamnesis_complete) {
        blocks.push({ ...BLOCK_MESSAGES.anamnesis_required, frage_key: null });
    }

    if (!isPreSessionComplete(preSession)) {
        blocks.push({ ...BLOCK_MESSAGES.pre_session_incomplete, frage_key: null });
    }

    for (const ko of koRechecks) {
        if (ko.permanent) {
            blocks.push({ ...BLOCK_MESSAGES.mindestalter_18, frage_key: ko.frage_key });
            continue;
        }
        const ans = effectiveKoAnswers[ko.frage_key];
        if (!ans) {
            blocks.push({ ...BLOCK_MESSAGES.pre_session_incomplete, frage_key: ko.frage_key });
            continue;
        }
        if (ans === 'still') {
            // Condition still present → warn, never block. Studio decides after contact.
            warnings.push(clarificationWarning(ko.frage_key, ko.frage_text));
        }
    }

    const unansweredRechecks = [];
    for (const f of roteFragen) {
        const parsed = parseAktuellGleich(lookupWiederholung(wiederholungen, f));
        if (!parsed.ok) {
            if (effectiveKoAnswers[f.frage_key] === 'changed' || effectiveKoAnswers[f.frage_key] === 'still') {
                if (effectiveKoAnswers[f.frage_key] === 'still') {
                    warnings.push(clarificationWarning(f.frage_key, f.frage_text));
                }
                continue;
            }
            unansweredRechecks.push(f);
            continue;
        }
        if (parsed.value === true) {
            warnings.push(clarificationWarning(f.frage_key, f.frage_text));
        }
    }

    if (unansweredRechecks.length > 0) {
        blocks.push({
            ...BLOCK_MESSAGES.wiederholungen_incomplete,
            frage_key: unansweredRechecks[0].frage_key,
        });
    }

    const changedKoKeys = collectRecoveryKeys(answers, effectiveKoAnswers, wiederholungen);

    const requiresKoSignature = changedKoKeys.length > 0;
    if (requiresKoSignature && !koSignature?.unterschrift_data) {
        blocks.push({ ...BLOCK_MESSAGES.ko_signature_required, frage_key: null, changed_ko_keys: changedKoKeys });
    }

    const { uvBlockDate, medicationBlockDate, preSessionCheck } =
        computeBlockDatesFromPreSession(preSession, new Date(), sperrfristen);
    const lockouts = summarizePreSessionLockouts(preSession, new Date(), sperrfristen);
    const uniqueWarnings = [];
    const seen = new Set();
    const clarificationLabels = [];
    for (const warning of warnings) {
        if (warning.code === CLARIFICATION_MESSAGE.code) {
            if (warning.frage_text && !clarificationLabels.includes(warning.frage_text)) {
                clarificationLabels.push(warning.frage_text);
            }
            continue;
        }
        const key = `${warning.code}:${warning.frage_key || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueWarnings.push(warning);
    }
    if (clarificationLabels.length) {
        const prefix = `${clarificationLabels.join(', ')}: `;
        uniqueWarnings.unshift({
            ...CLARIFICATION_MESSAGE,
            frage_key: null,
            conditions: clarificationLabels,
            message_de: `${prefix}${CLARIFICATION_MESSAGE.message_de}`,
            message_en: `${prefix}${CLARIFICATION_MESSAGE.message_en}`,
        });
    }

    return {
        can_proceed: blocks.length === 0,
        blocks,
        warnings: uniqueWarnings,
        requires_ko_signature: requiresKoSignature,
        changed_ko_keys: changedKoKeys,
        pre_session_check: preSessionCheck,
        block_dates: { uvBlockDate, medicationBlockDate },
        lockouts,
    };
};

const applyKoAnswerUpdates = (answers, koAnswers) => {
    const updated = { ...answers };
    for (const def of KO_RECHECKS) {
        if (def.permanent || !def.cleared_value) continue;
        if (koAnswers[def.frage_key] === 'changed') {
            updated[def.frage_key] = def.cleared_value;
        }
    }
    return updated;
};

const buildWiederholungenEntries = (roteFragen, wiederholungen, koAnswers, answers) => {
    const entries = [];
    const now = new Date().toISOString();

    for (const f of roteFragen) {
        const parsed = parseAktuellGleich(lookupWiederholung(wiederholungen, f));
        if (!parsed.ok) continue;
        entries.push({
            frage_nr: f.frage_nr,
            frage_key: f.frage_key,
            frage_text: f.frage_text,
            original_antwort: f.antwort,
            aktuell_gleich: parsed.value,
            aenderung: parsed.aenderung || '',
            datum: now,
        });
    }

    for (const def of KO_RECHECKS) {
        if (def.permanent || !def.trigger(answers)) continue;
        if (koAnswers[def.frage_key] === 'changed') {
            entries.push({
                frage_nr: def.frage_nr,
                frage_key: def.frage_key,
                frage_text: def.frage_text,
                original_antwort: answers[def.frage_key] || '',
                aktuell_gleich: false,
                aenderung: '',
                datum: now,
            });
        }
    }

    return entries;
};

const buildStatuswechselEntries = (koAnswers, answers, koSignature, customerName = '') => {
    const entries = [];
    const now = new Date();

    const KO_INFO = KO_RECOVERY_LABELS;

    for (const def of KO_RECHECKS) {
        if (def.permanent || !def.trigger(answers)) continue;
        if (koAnswers[def.frage_key] !== 'changed') continue;

        const info = KO_INFO[def.frage_key] || {};
        entries.push({
            von: 'rot',
            nach: 'gruen',
            frage_key: def.frage_key,
            frage_text: def.frage_text,
            original_antwort: info.original || answers[def.frage_key] || '',
            neue_antwort: info.neu || def.cleared_value,
            zeitstempel: now,
            unterschrift_data: koSignature?.unterschrift_data || null,
            name: customerName,
        });
    }

    return entries;
};

const mergeBlockDate = (existing, incoming) => {
    if (!incoming) return existing || null;
    if (!existing) return incoming;
    return startOfDay(incoming) > startOfDay(existing) ? incoming : existing;
};

const buildActivityEntries = (roteFragen, wiederholungen, koAnswers) => {
    const entries = [];
    const now = new Date();

    for (const f of roteFragen) {
        const parsed = parseAktuellGleich(lookupWiederholung(wiederholungen, f));
        if (!parsed.ok) continue;
        entries.push({
            type: 'rueckfrage_beantwortet',
            details: `Rückfrage: ${f.frage_text} → ${parsed.value ? 'Ja, stimmt noch' : 'Nein, hat sich geändert'}`,
            ts: now,
        });
    }

    const koLabels = {
        schwanger: 'Schwangerschaft',
        akute_erkrankung: 'Akute Erkrankung',
        alkohol_drogen: 'Alkohol/Drogen',
        urteilsfaehig: 'Urteilsfähigkeit',
    };

    for (const [key, label] of Object.entries(koLabels)) {
        if (!koAnswers[key]) continue;
        entries.push({
            type: 'rueckfrage_beantwortet',
            details: `Rückfrage: ${label} → ${koAnswers[key] === 'changed' ? 'Hat sich geändert' : 'Unverändert'}`,
            ts: now,
        });
    }

    return entries;
};

module.exports = {
    KO_RECHECKS,
    buildBookingPrecheckForm,
    validateBookingPrecheck,
    computeBlockDatesFromPreSession,
    summarizePreSessionLockouts,
    applyKoAnswerUpdates,
    buildWiederholungenEntries,
    buildStatuswechselEntries,
    mergeBlockDate,
    buildActivityEntries,
    computeAvailability,
    lookupWiederholung,
    parseAktuellGleich,
    collectRecoveryKeys,
    mergeRecoveryKoAnswers,
    KO_RECOVERY_LABELS,
    CLARIFICATION_MESSAGE,
};

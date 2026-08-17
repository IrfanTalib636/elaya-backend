const {
    normalizePreSessionCheck,
    computeAvailability,
    startOfDay,
} = require('./lockoutEngine');
const { computeAmpel } = require('./anamnesisEngine');

const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    d.setHours(0, 0, 0, 0);
    return d;
};

const UV_MODERATE_DAYS = 21;
const UV_INTENSE_DAYS = 28;
const MED_SHORT_DAYS = 14;
const MED_RETINOID_DAYS = 180;

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

const MEDICATION_GROUPS = [
    { key: 'keine', label_de: 'Keine / keine Medikamente', label_en: 'None / no medications', lock_days: 0 },
    { key: 'antibiotika', label_de: 'Antibiotika', label_en: 'Antibiotics', lock_days: MED_SHORT_DAYS },
    { key: 'antidepressiva', label_de: 'Antidepressiva', label_en: 'Antidepressants', lock_days: MED_SHORT_DAYS },
    { key: 'retinoide', label_de: 'Retinoide', label_en: 'Retinoids', lock_days: MED_RETINOID_DAYS },
];

const UV_OPTIONS = [
    { value: 'keine', label_de: 'Keine', label_en: 'None', lock_days: 0 },
    { value: 'leicht', label_de: 'Leicht', label_en: 'Light', lock_days: 0 },
    { value: 'mittel', label_de: 'Mittel', label_en: 'Moderate', lock_days: UV_MODERATE_DAYS },
    { value: 'intensiv', label_de: 'Intensiv', label_en: 'Intense', lock_days: UV_INTENSE_DAYS },
];

const BLOCK_MESSAGES = {
    mindestalter_18: {
        code: 'ko_permanent',
        message_de: 'Die Behandlung ist erst ab 18 Jahren möglich. Bitte kontaktiere das Studio.',
    },
    schwanger_still: {
        code: 'ko_still_active',
        message_de: 'Während Schwangerschaft oder Stillzeit ist eine Behandlung nicht möglich.',
    },
    akute_erkrankung_still: {
        code: 'health_not_recovered',
        message_de:
            'Du kannst die Buchung fortsetzen. Das Studio kontaktiert dich vor dem Termin, um deinen Gesundheitszustand zu klären. Die Behandlung kann verschoben werden, wenn du noch nicht genesen bist.',
        message_en:
            'You can continue with the booking. The studio will contact you before the appointment to clarify your current health condition. Treatment may need to be postponed if you are still unwell.',
    },
    alkohol_drogen_still: {
        code: 'ko_still_active',
        message_de: 'Unter diesem Einfluss ist eine Behandlung nicht möglich.',
    },
    urteilsfaehig_still: {
        code: 'ko_still_active',
        message_de: 'Für eine Behandlung benötigen wir deine freiwillige Zustimmung.',
    },
    akute_erkrankung_wiederholung: {
        code: 'health_not_recovered',
        message_de:
            'Du kannst die Buchung fortsetzen. Das Studio kontaktiert dich vor dem Termin, um deinen Gesundheitszustand zu klären. Die Behandlung kann verschoben werden, wenn du noch nicht genesen bist.',
        message_en:
            'You can continue with the booking. The studio will contact you before the appointment to clarify your current health condition. Treatment may need to be postponed if you are still unwell.',
    },
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

const buildBookingPrecheckForm = (caseDoc, anamnesis) => {
    const answers = anamnesis?.antworten || {};
    const ampel = computeAmpel(answers);

    return {
        case_id: caseDoc._id.toString(),
        consultation_only_skips_ps01: true,
        prerequisites: buildPrerequisites(caseDoc),
        ps01: {
            title: 'Kurz-Check vor dem Termin',
            subtitle: 'Dauert nur 30 Sekunden. Pflicht vor jeder Behandlung.',
            uv_options: UV_OPTIONS,
            medication_question:
                'Hast du in den letzten 6 Monaten Medikamente eingenommen?',
            medication_question_en:
                'Have you taken any medications in the last 6 months?',
            medication_groups: MEDICATION_GROUPS,
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
const summarizePreSessionLockouts = (preSession = {}, now = new Date()) => {
    const rawMeds = Array.isArray(preSession.medikamente)
        ? preSession.medikamente.filter(Boolean)
        : [];
    const check = normalizePreSessionCheck(preSession);
    const heute = startOfDay(now);
    const notices = [];

    if (check.uv_exposition === 'intensiv' || check.uv_exposition === 'mittel') {
        const days = check.uv_exposition === 'intensiv' ? UV_INTENSE_DAYS : UV_MODERATE_DAYS;
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
            { key: 'retinoide', days: MED_RETINOID_DAYS, label_de: 'Retinoide', label_en: 'retinoids' },
            { key: 'antibiotika', days: MED_SHORT_DAYS, label_de: 'Antibiotika', label_en: 'antibiotics' },
            { key: 'antidepressiva', days: MED_SHORT_DAYS, label_de: 'Antidepressiva', label_en: 'antidepressants' },
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


const computeBlockDatesFromPreSession = (preSession = {}, now = new Date()) => {
    const check = normalizePreSessionCheck(preSession);
    const heute = startOfDay(now);
    let uvBlockDate = null;
    let medicationBlockDate = null;

    if (check.uv_exposition === 'intensiv') {
        uvBlockDate = addDays(heute, UV_INTENSE_DAYS);
    } else if (check.uv_exposition === 'mittel') {
        uvBlockDate = addDays(heute, UV_MODERATE_DAYS);
    }

    const meds = check.medikamente || [];
    const intakeDate = check.medikament_datum ? startOfDay(check.medikament_datum) : heute;
    let maxMedUntil = null;

    if (meds.includes('retinoide')) {
        maxMedUntil = addDays(intakeDate, MED_RETINOID_DAYS);
    }
    if (meds.includes('antibiotika')) {
        maxMedUntil = maxMedUntil
            ? (addDays(intakeDate, MED_SHORT_DAYS) > maxMedUntil ? addDays(intakeDate, MED_SHORT_DAYS) : maxMedUntil)
            : addDays(intakeDate, MED_SHORT_DAYS);
    }
    if (meds.includes('antidepressiva')) {
        const until = addDays(intakeDate, MED_SHORT_DAYS);
        maxMedUntil = maxMedUntil ? (until > maxMedUntil ? until : maxMedUntil) : until;
    }

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
        const ans = koAnswers[ko.frage_key];
        if (!ans) {
            blocks.push({ ...BLOCK_MESSAGES.pre_session_incomplete, frage_key: ko.frage_key });
            continue;
        }
        if (ans === 'still') {
            if (ko.frage_key === 'akute_erkrankung') {
                warnings.push({
                    ...BLOCK_MESSAGES.akute_erkrankung_still,
                    frage_key: ko.frage_key,
                });
                continue;
            }
            const msgKey = `${ko.frage_key}_still`;
            blocks.push({
                ...(BLOCK_MESSAGES[msgKey] || BLOCK_MESSAGES.ko_still_active),
                frage_key: ko.frage_key,
            });
        }
    }

    for (const f of roteFragen) {
        const ans =
            wiederholungen[f.frage_key] ??
            wiederholungen[String(f.frage_nr)] ??
            wiederholungen[f.frage_nr];
        if (!ans || typeof ans.aktuell_gleich !== 'boolean') {
            blocks.push({ ...BLOCK_MESSAGES.wiederholungen_incomplete, frage_key: f.frage_key });
            continue;
        }
        if (f.frage_key === 'akute_erkrankung' && ans.aktuell_gleich === true) {
            warnings.push({
                ...BLOCK_MESSAGES.akute_erkrankung_wiederholung,
                frage_key: f.frage_key,
            });
        }
    }

    if (roteFragen.length > 0 && !wiederholungenConfirmed) {
        blocks.push({ ...BLOCK_MESSAGES.wiederholungen_incomplete, frage_key: null });
    }

    const changedKoKeys = KO_RECHECKS.filter(
        (def) => def.trigger(answers) && koAnswers[def.frage_key] === 'changed'
    ).map((def) => def.frage_key);

    const requiresKoSignature = changedKoKeys.length > 0;
    if (requiresKoSignature && !koSignature?.unterschrift_data) {
        blocks.push({ ...BLOCK_MESSAGES.ko_signature_required, frage_key: null, changed_ko_keys: changedKoKeys });
    }

    const { uvBlockDate, medicationBlockDate, preSessionCheck } =
        computeBlockDatesFromPreSession(preSession);
    const lockouts = summarizePreSessionLockouts(preSession);
    const uniqueWarnings = [];
    const seen = new Set();
    for (const warning of warnings) {
        const key = `${warning.code}:${warning.frage_key || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        uniqueWarnings.push(warning);
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
        const ans =
            wiederholungen[f.frage_key] ??
            wiederholungen[String(f.frage_nr)] ??
            wiederholungen[f.frage_nr];
        if (!ans) continue;
        entries.push({
            frage_nr: f.frage_nr,
            frage_key: f.frage_key,
            frage_text: f.frage_text,
            original_antwort: f.antwort,
            aktuell_gleich: ans.aktuell_gleich,
            aenderung: ans.aenderung || '',
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

    const KO_INFO = {
        schwanger: { original: 'Schwanger/stillend', neu: 'Nicht mehr schwanger/stillend' },
        akute_erkrankung: { original: 'Akut krank', neu: 'Von akuter Erkrankung genesen' },
        alkohol_drogen: { original: 'Unter Einfluss', neu: 'Nicht mehr unter Einfluss' },
        urteilsfaehig: { original: 'Nicht urteilsfähig', neu: 'Urteilsfähigkeit wiederhergestellt' },
    };

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
        const ans =
            wiederholungen[f.frage_key] ??
            wiederholungen[String(f.frage_nr)] ??
            wiederholungen[f.frage_nr];
        if (!ans) continue;
        entries.push({
            type: 'rueckfrage_beantwortet',
            details: `Rückfrage: ${f.frage_text} → ${ans.aktuell_gleich ? 'Ja, stimmt noch' : 'Nein, hat sich geändert'}`,
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
};

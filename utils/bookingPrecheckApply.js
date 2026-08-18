const Anamnesis = require('../models/anamnesisModel');
const Customer = require('../models/customerModel');
const CrmTask = require('../models/crmTaskModel');
const ApiError = require('../utils/ApiError');
const { CRM_TASK_TYP, CRM_TASK_PRIORITAET } = require('../config/crmDefaults');
const { computeAmpel, buildAnamnesisEvaluation } = require('../utils/anamnesisEngine');
const {
    KO_RECHECKS,
    validateBookingPrecheck,
    applyKoAnswerUpdates,
    buildWiederholungenEntries,
    buildStatuswechselEntries,
    mergeBlockDate,
    buildActivityEntries,
    lookupWiederholung,
    parseAktuellGleich,
    mergeRecoveryKoAnswers,
} = require('../utils/bookingPrecheckEngine');
const { formatApptStamp } = require('./activityLog');

const collectClarificationFlags = (roteFragen = [], bookingPrecheck = {}) => {
    const koAnswers = bookingPrecheck.ko_answers || {};
    const wiederholungen = bookingPrecheck.wiederholungen || {};
    const flags = [];
    const seen = new Set();

    const pushFlag = (flag) => {
        const key = flag.frage_key || String(flag.frage_nr);
        if (!key || seen.has(key)) return;
        seen.add(key);
        flags.push(flag);
    };

    for (const f of roteFragen) {
        const parsed = parseAktuellGleich(lookupWiederholung(wiederholungen, f));
        if (parsed.ok && parsed.value === true) {
            pushFlag({
                frage_nr: f.frage_nr,
                frage_key: f.frage_key,
                frage_text: f.frage_text,
            });
        }
    }

    for (const def of KO_RECHECKS) {
        if (def.permanent || koAnswers[def.frage_key] !== 'still') continue;
        pushFlag({
            frage_nr: def.frage_nr,
            frage_key: def.frage_key,
            frage_text: def.frage_text,
        });
    }

    return flags;
};

const flagConditionsForStudioReview = (anamnesis, caseDoc, flags = []) => {
    if (!flags.length) return;
    if (!anamnesis.klaerung || typeof anamnesis.klaerung !== 'object') {
        anamnesis.klaerung = {};
    }

    const now = new Date();
    for (const flag of flags) {
        if (flag.frage_nr == null) continue;
        const key = `F${flag.frage_nr}`;
        anamnesis.klaerung[key] = {
            status: 'in_klaerung',
            notiz:
                `Kunde hat beim Kurz-Check bestätigt: ${flag.frage_text} besteht weiterhin. ` +
                'Bitte vor dem Termin klären — die Behandlung ist nicht automatisch ausgeschlossen.',
            datum: now,
            frage_key: flag.frage_key,
        };
    }
    anamnesis.markModified('klaerung');

    const labels = flags.map((f) => f.frage_text).filter(Boolean).join(', ');
    caseDoc.activityLog.push({
        type: 'klaerung_update',
        details: `Kurz-Check: Studio-Klärung erforderlich (${labels}). Kunde hat trotzdem gebucht.`,
        ts: now,
    });
};

const notifyStudioForClarification = async (caseDoc, flags = []) => {
    if (!flags.length || !caseDoc.studio || !caseDoc.customer) return;

    const labels = flags.map((f) => f.frage_text).filter(Boolean).join(', ');
    const titel = `Medizinische Klärung vor Termin: ${labels || 'Anamnese-Flag'}`;

    const existing = await CrmTask.findOne({
        studio: caseDoc.studio,
        customer: caseDoc.customer,
        erledigt: false,
        titel,
    }).lean();
    if (existing) return;

    await CrmTask.create({
        studio: caseDoc.studio,
        customer: caseDoc.customer,
        titel,
        typ: CRM_TASK_TYP.ANRUF,
        prioritaet: CRM_TASK_PRIORITAET.HOCH,
        faellig_am: new Date(),
    });
};

const syncAnamnesisAfterPrecheck = async (caseDoc, anamnesis, bookingPrecheck, customerName = '') => {
    const {
        ko_answers: koAnswers = {},
        wiederholungen = {},
        ko_signature: koSignature = null,
    } = bookingPrecheck;

    const answers = anamnesis.antworten || {};
    const mergedKoAnswers = mergeRecoveryKoAnswers(answers, koAnswers, wiederholungen);
    const ampel = computeAmpel(answers);
    const updatedAnswers = applyKoAnswerUpdates(answers, mergedKoAnswers);
    const wiederholungenNeu = buildWiederholungenEntries(
        ampel.rote_fragen,
        wiederholungen,
        mergedKoAnswers,
        answers
    );
    const statuswechselNeu = buildStatuswechselEntries(
        mergedKoAnswers,
        answers,
        koSignature,
        customerName
    );

    if (wiederholungenNeu.length) {
        anamnesis.wiederholungen.push(...wiederholungenNeu);
    }

    if (statuswechselNeu.length) {
        anamnesis.statuswechsel.push(...statuswechselNeu);
        for (const sw of statuswechselNeu) {
            caseDoc.activityLog.push({
                type: 'status_geaendert',
                ts: sw.zeitstempel,
                details: `Statuswechsel 🔴→🟢: ${sw.frage_text} · ${sw.neue_antwort}`,
            });
        }
    }

    const answersChanged = JSON.stringify(updatedAnswers) !== JSON.stringify(answers);
    if (answersChanged) {
        anamnesis.antworten = updatedAnswers;
        anamnesis.markModified('antworten');

        const newAmpel = computeAmpel(updatedAnswers);
        anamnesis.ampel_status = newAmpel.ampel_status;
        anamnesis.orange_fragen = newAmpel.orange_keys;
        anamnesis.rote_fragen = newAmpel.rote_keys;

        if (anamnesis.ampel_status !== ampel.ampel_status) {
            anamnesis.statuswechsel.push({
                von: ampel.ampel_status,
                nach: newAmpel.ampel_status,
                zeitstempel: new Date(),
            });
        }
    }

    await anamnesis.save();

    const evaluation = buildAnamnesisEvaluation(anamnesis.antworten || {});
    caseDoc.medical_flag_level = evaluation.ampel_status;
    caseDoc.open_medical_flags_count = evaluation.open_medical_flags_count;

    return { wiederholungenNeu, statuswechselNeu, evaluation };
};

const applyBookingPrecheckToCase = async (caseDoc, bookingPrecheck, options = {}) => {
    const {
        consultationOnly = false,
        pre_session: preSession = {},
        ko_answers: koAnswers = {},
        wiederholungen = {},
        wiederholungen_confirmed: wiederholungenConfirmed = false,
        ko_signature: koSignature = null,
    } = bookingPrecheck;

    if (consultationOnly) {
        return { preSessionCheck: {}, applied: false };
    }

    const anamnesis = await Anamnesis.findOne({ case: caseDoc._id });
    if (!anamnesis) {
        throw new ApiError(400, 'Anamnesis must be completed before booking a treatment');
    }

    const mergedKoAnswers = mergeRecoveryKoAnswers(
        anamnesis.antworten || {},
        koAnswers,
        wiederholungen
    );

    const validation = validateBookingPrecheck({
        caseDoc,
        anamnesis,
        consultationOnly: false,
        preSession: preSession,
        koAnswers: mergedKoAnswers,
        wiederholungen,
        wiederholungenConfirmed,
        koSignature,
    });

    if (!validation.can_proceed) {
        throw new ApiError(400, 'Booking pre-check failed', { blocks: validation.blocks });
    }

    const customer = options.customerName
        ? null
        : await Customer.findById(caseDoc.customer).select('vorname nachname').lean();
    const customerName =
        options.customerName ||
        `${customer?.vorname ?? ''} ${customer?.nachname ?? ''}`.trim();

    const ampel = computeAmpel(anamnesis.antworten || {});
    await syncAnamnesisAfterPrecheck(
        caseDoc,
        anamnesis,
        { ...bookingPrecheck, ko_answers: mergedKoAnswers },
        customerName
    );

    const clarificationFlags = collectClarificationFlags(ampel.rote_fragen, bookingPrecheck);
    if (clarificationFlags.length) {
        flagConditionsForStudioReview(anamnesis, caseDoc, clarificationFlags);
        await anamnesis.save();
        const evaluation = buildAnamnesisEvaluation(
            anamnesis.antworten || {},
            anamnesis.klaerung || {}
        );
        caseDoc.medical_flag_level = evaluation.ampel_status;
        caseDoc.open_medical_flags_count = evaluation.open_medical_flags_count;
        try {
            await notifyStudioForClarification(caseDoc, clarificationFlags);
        } catch (err) {
            console.error('Studio clarification CRM task failed:', err.message);
        }
    }

    const activityEntries = buildActivityEntries(ampel.rote_fragen, wiederholungen, koAnswers);
    for (const entry of activityEntries) {
        caseDoc.activityLog.push(entry);
    }

    const prevUv = caseDoc.uvBlockDate;
    const prevMed = caseDoc.medicationBlockDate;
    caseDoc.uvBlockDate = mergeBlockDate(caseDoc.uvBlockDate, validation.block_dates.uvBlockDate);
    caseDoc.medicationBlockDate = mergeBlockDate(
        caseDoc.medicationBlockDate,
        validation.block_dates.medicationBlockDate
    );

    const now = new Date();
    if (
        validation.block_dates.uvBlockDate &&
        (!prevUv || new Date(caseDoc.uvBlockDate).getTime() !== new Date(prevUv).getTime())
    ) {
        caseDoc.activityLog.push({
            type: 'lockout',
            ts: now,
            details: `Sperrfrist Sonne/UV bis ${formatApptStamp(caseDoc.uvBlockDate)}`,
        });
    }
    if (
        validation.block_dates.medicationBlockDate &&
        (!prevMed ||
            new Date(caseDoc.medicationBlockDate).getTime() !== new Date(prevMed).getTime())
    ) {
        caseDoc.activityLog.push({
            type: 'lockout',
            ts: now,
            details: `Sperrfrist Medikamente bis ${formatApptStamp(caseDoc.medicationBlockDate)}`,
        });
    }

    await caseDoc.save();

    return {
        preSessionCheck: validation.pre_session_check,
        applied: true,
        block_dates: validation.block_dates,
        warnings: validation.warnings,
    };
};

module.exports = {
    applyBookingPrecheckToCase,
    syncAnamnesisAfterPrecheck,
};

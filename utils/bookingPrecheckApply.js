const Anamnesis = require('../models/anamnesisModel');
const Customer = require('../models/customerModel');
const ApiError = require('../utils/ApiError');
const { computeAmpel, buildAnamnesisEvaluation } = require('../utils/anamnesisEngine');
const {
    validateBookingPrecheck,
    applyKoAnswerUpdates,
    buildWiederholungenEntries,
    buildStatuswechselEntries,
    mergeBlockDate,
    buildActivityEntries,
} = require('../utils/bookingPrecheckEngine');

const HEALTH_KLAERUNG_NOTE =
    'Kunde hat beim Kurz-Check angegeben, noch nicht vollständig genesen zu sein. Bitte vor dem Termin klären.';

const isStillUnwell = (bookingPrecheck = {}) => {
    const koAnswers = bookingPrecheck.ko_answers || {};
    if (koAnswers.akute_erkrankung === 'still') return true;
    const wiederholungen = bookingPrecheck.wiederholungen || {};
    return (
        wiederholungen.akute_erkrankung?.aktuell_gleich === true ||
        wiederholungen['3']?.aktuell_gleich === true
    );
};

const flagHealthForStudioReview = (anamnesis, caseDoc) => {
    if (!anamnesis.klaerung || typeof anamnesis.klaerung !== 'object') {
        anamnesis.klaerung = {};
    }
    anamnesis.klaerung.F3 = {
        status: 'in_klaerung',
        notiz: HEALTH_KLAERUNG_NOTE,
        datum: new Date(),
        frage_key: 'akute_erkrankung',
    };
    anamnesis.markModified('klaerung');

    caseDoc.activityLog.push({
        type: 'klaerung_update',
        details:
            'Kurz-Check: Kunde noch nicht genesen — Studio-Klärung erforderlich (Flag F3).',
        ts: new Date(),
    });
};

const syncAnamnesisAfterPrecheck = async (caseDoc, anamnesis, bookingPrecheck, customerName = '') => {
    const {
        ko_answers: koAnswers = {},
        wiederholungen = {},
        ko_signature: koSignature = null,
    } = bookingPrecheck;

    const answers = anamnesis.antworten || {};
    const ampel = computeAmpel(answers);
    const updatedAnswers = applyKoAnswerUpdates(answers, koAnswers);
    const wiederholungenNeu = buildWiederholungenEntries(
        ampel.rote_fragen,
        wiederholungen,
        koAnswers,
        answers
    );
    const statuswechselNeu = buildStatuswechselEntries(
        koAnswers,
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

    let anamnesis = await Anamnesis.findOne({ case: caseDoc._id });
    if (!anamnesis) {
        throw new ApiError(400, 'Anamnesis must be completed before booking a treatment');
    }

    const validation = validateBookingPrecheck({
        caseDoc,
        anamnesis,
        consultationOnly: false,
        preSession: preSession,
        koAnswers,
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
    await syncAnamnesisAfterPrecheck(caseDoc, anamnesis, bookingPrecheck, customerName);

    if (isStillUnwell(bookingPrecheck)) {
        flagHealthForStudioReview(anamnesis, caseDoc);
        await anamnesis.save();
        const evaluation = buildAnamnesisEvaluation(
            anamnesis.antworten || {},
            anamnesis.klaerung || {}
        );
        caseDoc.medical_flag_level = evaluation.ampel_status;
        caseDoc.open_medical_flags_count = evaluation.open_medical_flags_count;
    }

    const activityEntries = buildActivityEntries(ampel.rote_fragen, wiederholungen, koAnswers);
    for (const entry of activityEntries) {
        caseDoc.activityLog.push(entry);
    }

    caseDoc.uvBlockDate = mergeBlockDate(caseDoc.uvBlockDate, validation.block_dates.uvBlockDate);
    caseDoc.medicationBlockDate = mergeBlockDate(
        caseDoc.medicationBlockDate,
        validation.block_dates.medicationBlockDate
    );

    await caseDoc.save();

    return {
        preSessionCheck: validation.pre_session_check,
        applied: true,
        block_dates: validation.block_dates,
    };
};

module.exports = {
    applyBookingPrecheckToCase,
    syncAnamnesisAfterPrecheck,
};

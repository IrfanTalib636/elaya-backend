const Case = require('../models/caseModel');
const Studio = require('../models/studioModel');
const Anamnesis = require('../models/anamnesisModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertCaseAccess, isStudio, isAdmin } = require('../utils/accessHelpers');
const {
    computeAmpel,
    buildAnamnesisEvaluation,
    isAnamnesisComplete,
    KLAERUNG_STATUS,
} = require('../utils/anamnesisEngine');
const { vergebeElaycoins } = require('../utils/elaycoinEngine');
const { STUDIO_FREIGABE_STATUS } = require('../config/constants');

const STUDIO_FREIGABE_CHAT_TEXT =
    'Deine Anamnese wurde erfolgreich abgeschlossen. Aufgrund deiner Angaben prüft das Studio deine Unterlagen und gibt dir schnellstmöglich Bescheid. Bei dringenden Fragen wende dich bitte an dein Studio.';

const FREIGABE_CHAT_FREIGEGEBEN =
    'Gute Neuigkeit! Das Studio hat deine Unterlagen geprüft und die Behandlung freigegeben. Du kannst jetzt deinen Termin buchen.';

const FREIGABE_CHAT_ABGELEHNT =
    'Das Studio hat deine medizinischen Unterlagen geprüft. Bitte kontaktiere dein Studio für die nächsten Schritte.';

const staffLabel = (user) => user?.email || 'Studio';

const formatAnamnesis = (doc, caseDoc = null) => {
    const payload = doc.toObject ? doc.toObject() : { ...doc };
    const klaerung = payload.klaerung || {};
    const evaluation = buildAnamnesisEvaluation(payload.antworten || {}, klaerung);

    return {
        id: payload._id,
        case: payload.case,
        ampel_status: evaluation.ampel_status,
        raw_ampel_status: evaluation.raw_ampel_status,
        orange_fragen: evaluation.orange_fragen,
        rote_fragen: evaluation.rote_fragen,
        inline_hints: evaluation.inline_hints,
        has_ko_flags: evaluation.has_ko_flags,
        studio_freigabe: caseDoc?.studio_freigabe ?? evaluation.studio_freigabe,
        summary: evaluation.summary,
        open_medical_flags_count: evaluation.open_medical_flags_count,
        antworten: payload.antworten,
        wiederholungen: payload.wiederholungen,
        statuswechsel: payload.statuswechsel,
        klaerung,
        audit_log: payload.audit_log || [],
        filled: evaluation.filled,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
    };
};

const appendAudit = (anamnesis, entry) => {
    if (!Array.isArray(anamnesis.audit_log)) {
        anamnesis.audit_log = [];
    }
    anamnesis.audit_log.push({
        ...entry,
        zeitstempel: entry.zeitstempel || new Date(),
    });
    anamnesis.markModified('audit_log');
};

const syncAmpelIfStale = async (anamnesis) => {
    const klaerung = anamnesis.klaerung || {};
    const evaluation = buildAnamnesisEvaluation(anamnesis.antworten || {}, klaerung);
    const ampel = computeAmpel(anamnesis.antworten || {});

    const keysMatch =
        JSON.stringify(anamnesis.orange_fragen) === JSON.stringify(ampel.orange_keys) &&
        JSON.stringify(anamnesis.rote_fragen) === JSON.stringify(ampel.rote_keys);

    if (anamnesis.ampel_status === evaluation.ampel_status && keysMatch) {
        return anamnesis;
    }

    // Keys from answers stay the source of flagged questions; ampel_status is effective (with klaerung)
    anamnesis.orange_fragen = ampel.orange_keys;
    anamnesis.rote_fragen = ampel.rote_keys;
    anamnesis.ampel_status = evaluation.ampel_status;
    await anamnesis.save();

    return anamnesis;
};

const syncCaseMedicalFlags = async (caseDoc, answers, klaerung = {}) => {
    const evaluation = buildAnamnesisEvaluation(answers, klaerung);
    const freigabe = evaluation.studio_freigabe;

    const previousFreigabeRequired = caseDoc.studio_freigabe?.erforderlich === true;
    const freigabeNowRequired = freigabe.erforderlich === true;

    caseDoc.medical_flag_level = evaluation.ampel_status;
    caseDoc.open_medical_flags_count = evaluation.open_medical_flags_count;
    caseDoc.anamnesis_complete = true;

    if (freigabeNowRequired) {
        const existing = caseDoc.studio_freigabe?.toObject?.() ?? caseDoc.studio_freigabe ?? {};
        caseDoc.studio_freigabe = {
            erforderlich: true,
            status:
                existing.status === STUDIO_FREIGABE_STATUS.FREIGEGEBEN ||
                existing.status === STUDIO_FREIGABE_STATUS.ABGLEHNT
                    ? existing.status
                    : STUDIO_FREIGABE_STATUS.AUSSTEHEND,
            ausloeser: freigabe.ausloeser,
            datum: existing.datum ?? null,
            notiz: existing.notiz ?? '',
            grund: existing.grund ?? '',
            bearbeitet_von: existing.bearbeitet_von ?? '',
            bearbeitet_von_id: existing.bearbeitet_von_id ?? null,
        };

        if (!previousFreigabeRequired) {
            caseDoc.chat_nachrichten.push({
                von: 'studio',
                typ: 'system',
                text: STUDIO_FREIGABE_CHAT_TEXT,
                datum: new Date(),
                gelesen: false,
            });
            caseDoc.markModified('chat_nachrichten');
        }
    } else {
        caseDoc.studio_freigabe = {
            erforderlich: false,
            status: STUDIO_FREIGABE_STATUS.NICHT_ERFORDERLICH,
            ausloeser: [],
            datum: null,
            notiz: '',
            grund: '',
            bearbeitet_von: '',
            bearbeitet_von_id: null,
        };
    }

    caseDoc.markModified('studio_freigabe');
    await caseDoc.save();

    return evaluation;
};

const getCaseAnamnesis = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    assertCaseAccess(req.user, caseDoc);

    let anamnesis = await Anamnesis.findOne({ case: caseDoc._id });

    if (anamnesis) {
        await syncAmpelIfStale(anamnesis);
        anamnesis = await Anamnesis.findById(anamnesis._id);
    }

    res.status(200).json({
        success: true,
        data: anamnesis ? formatAnamnesis(anamnesis, caseDoc) : null,
    });
});

const previewCaseAnamnesis = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    assertCaseAccess(req.user, caseDoc);

    const { antworten = {} } = req.body;
    const evaluation = buildAnamnesisEvaluation(antworten);

    res.status(200).json({
        success: true,
        data: evaluation,
    });
});

const upsertCaseAnamnesis = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    assertCaseAccess(req.user, caseDoc);

    const { antworten } = req.body;

    if (!isAnamnesisComplete(antworten)) {
        throw new ApiError(400, 'All anamnesis questions must be answered');
    }

    const { ampel_status, orange_keys, rote_keys } = computeAmpel(antworten);
    const now = new Date();

    const enrichedAntworten = {
        ...antworten,
        zeitstempel: now.toISOString(),
        ausgefuellt_im_studio: antworten.ausgefuellt_im_studio ?? isStudio(req.user.role),
        mitarbeiter: antworten.mitarbeiter || req.user.email,
    };

    let anamnesis = await Anamnesis.findOne({ case: caseDoc._id });
    const isNew = !anamnesis;

    if (isNew) {
        anamnesis = await Anamnesis.create({
            case: caseDoc._id,
            ampel_status,
            orange_fragen: orange_keys,
            rote_fragen: rote_keys,
            antworten: enrichedAntworten,
            klaerung: {},
            audit_log: [
                {
                    typ: 'anamnesis_submitted',
                    details: 'Anamnese eingereicht',
                    bearbeitet_von: staffLabel(req.user),
                    bearbeitet_von_id: req.user._id,
                    zeitstempel: now,
                    ampel_status,
                },
            ],
            statuswechsel: [
                {
                    von: null,
                    nach: ampel_status,
                    zeitstempel: now,
                },
            ],
        });
    } else {
        const previousAnswers = { ...(anamnesis.antworten || {}) };
        const previousAmpel = anamnesis.ampel_status;

        // Archive previous answers — original history preserved in wiederholungen
        if (previousAnswers.zeitstempel) {
            anamnesis.wiederholungen.push({
                ...previousAnswers,
                archiviert_am: now,
            });
        }

        if (previousAmpel !== ampel_status) {
            anamnesis.statuswechsel.push({
                von: previousAmpel,
                nach: ampel_status,
                zeitstempel: now,
            });
        }

        appendAudit(anamnesis, {
            typ: 'anamnesis_updated',
            details: 'Anamnese aktualisiert (Antworten archiviert in wiederholungen)',
            bearbeitet_von: staffLabel(req.user),
            bearbeitet_von_id: req.user._id,
            zeitstempel: now,
            ampel_status,
            previous_ampel: previousAmpel,
        });

        // Fresh answers → reset klaerung (new flags need new review)
        anamnesis.klaerung = {};
        anamnesis.markModified('klaerung');
        anamnesis.ampel_status = ampel_status;
        anamnesis.orange_fragen = orange_keys;
        anamnesis.rote_fragen = rote_keys;
        anamnesis.antworten = enrichedAntworten;
        anamnesis.markModified('antworten');
        await anamnesis.save();
    }

    await syncCaseMedicalFlags(caseDoc, enrichedAntworten, anamnesis.klaerung || {});

    const responseDoc = anamnesis.toObject ? anamnesis.toObject() : { ...anamnesis };
    responseDoc.antworten = enrichedAntworten;

    const studio = await Studio.findById(caseDoc.studio).select('firma elaycoin_studio_cfg').lean();
    await vergebeElaycoins(
        caseDoc.customer,
        'anamnese_vollstaendig',
        { case_id: caseDoc._id },
        { studio, studioOverrides: studio?.elaycoin_studio_cfg || {} }
    );

    res.status(isNew ? 201 : 200).json({
        success: true,
        message: isNew ? 'Anamnesis created' : 'Anamnesis updated',
        data: formatAnamnesis(responseDoc, caseDoc),
        case_flags: {
            medical_flag_level: caseDoc.medical_flag_level,
            open_medical_flags_count: caseDoc.open_medical_flags_count,
            anamnesis_complete: caseDoc.anamnesis_complete,
            studio_freigabe: caseDoc.studio_freigabe,
        },
    });
});

/** PATCH /cases/:id/anamnesis/klaerung — studio review of one medical flag */
const updateKlaerung = asyncHandler(async (req, res) => {
    if (!isStudio(req.user.role) && !isAdmin(req.user.role)) {
        throw new ApiError(403, 'Only studio staff can update klaerung');
    }

    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) throw new ApiError(404, 'Case not found');
    assertCaseAccess(req.user, caseDoc);

    const anamnesis = await Anamnesis.findOne({ case: caseDoc._id });
    if (!anamnesis) throw new ApiError(404, 'Anamnesis not found');

    const { frage_key: frageKey, status, notiz = '' } = req.body;
    const evaluation = buildAnamnesisEvaluation(anamnesis.antworten || {}, anamnesis.klaerung || {});
    const allFlags = [...evaluation.rote_fragen, ...evaluation.orange_fragen];
    const flag = allFlags.find((f) => `F${f.frage_nr}` === frageKey);

    if (!flag) {
        throw new ApiError(400, `No open medical flag for ${frageKey}`);
    }

    if (!anamnesis.klaerung || typeof anamnesis.klaerung !== 'object') {
        anamnesis.klaerung = {};
    }

    const prev = anamnesis.klaerung[frageKey] || {};
    const previousStatus = prev.status || KLAERUNG_STATUS.OFFEN;
    const now = new Date();
    const label = staffLabel(req.user);

    // antworten are NEVER modified here
    anamnesis.klaerung[frageKey] = {
        status,
        notiz,
        datum: now.toISOString(),
        geklaert_von: label,
        bearbeitet_von_id: req.user._id,
        frage_nr: flag.frage_nr,
        frage_key: flag.frage_key,
        frage_text: flag.frage_text,
        original_antwort: flag.antwort,
    };
    anamnesis.markModified('klaerung');

    const nextEval = buildAnamnesisEvaluation(anamnesis.antworten || {}, anamnesis.klaerung);
    const previousAmpel = anamnesis.ampel_status;
    anamnesis.ampel_status = nextEval.ampel_status;

    if (previousAmpel !== nextEval.ampel_status) {
        anamnesis.statuswechsel.push({
            von: previousAmpel,
            nach: nextEval.ampel_status,
            zeitstempel: now,
            quelle: 'klaerung',
            frage_key: frageKey,
        });
    }

    appendAudit(anamnesis, {
        typ: 'klaerung_update',
        frage_key: frageKey,
        frage_text: flag.frage_text,
        von_status: previousStatus,
        nach_status: status,
        notiz,
        bearbeitet_von: label,
        bearbeitet_von_id: req.user._id,
        zeitstempel: now,
        ampel_von: previousAmpel,
        ampel_nach: nextEval.ampel_status,
        details: `Klärung ${frageKey}: ${previousStatus} → ${status}`,
    });

    await anamnesis.save();

    caseDoc.medical_flag_level = nextEval.ampel_status;
    caseDoc.open_medical_flags_count = nextEval.open_medical_flags_count;
    caseDoc.activityLog.push({
        type: 'klaerung_update',
        ts: now,
        details: `${frageKey} ${flag.frage_text}: ${previousStatus} → ${status} · ${label}`,
    });
    await caseDoc.save();

    res.status(200).json({
        success: true,
        message: 'Klaerung updated',
        data: formatAnamnesis(anamnesis, caseDoc),
        case_flags: {
            medical_flag_level: caseDoc.medical_flag_level,
            open_medical_flags_count: caseDoc.open_medical_flags_count,
            studio_freigabe: caseDoc.studio_freigabe,
        },
    });
});

/** PATCH /cases/:id/studio-freigabe — approve / reject Stufe-2 freigabe */
const updateStudioFreigabe = asyncHandler(async (req, res) => {
    if (!isStudio(req.user.role) && !isAdmin(req.user.role)) {
        throw new ApiError(403, 'Only studio staff can update studio freigabe');
    }

    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) throw new ApiError(404, 'Case not found');
    assertCaseAccess(req.user, caseDoc);

    if (!caseDoc.studio_freigabe?.erforderlich) {
        throw new ApiError(400, 'Studio freigabe is not required for this case');
    }

    const { status, notiz = '', grund = '' } = req.body;
    const previous = caseDoc.studio_freigabe?.status;
    const now = new Date();
    const label = staffLabel(req.user);

    caseDoc.studio_freigabe = {
        ...((caseDoc.studio_freigabe?.toObject?.() ?? caseDoc.studio_freigabe) || {}),
        erforderlich: true,
        status,
        notiz,
        grund: status === STUDIO_FREIGABE_STATUS.ABGLEHNT ? grund || notiz : grund,
        datum: now,
        bearbeitet_von: label,
        bearbeitet_von_id: req.user._id,
    };
    caseDoc.markModified('studio_freigabe');

    caseDoc.activityLog.push({
        type: 'freigabe_update',
        ts: now,
        details: `Freigabe: ${previous} → ${status} · ${label}`,
    });

    if (status === STUDIO_FREIGABE_STATUS.FREIGEGEBEN) {
        caseDoc.chat_nachrichten.push({
            von: 'studio',
            typ: 'system',
            text: FREIGABE_CHAT_FREIGEGEBEN,
            datum: now,
            gelesen: false,
        });
        caseDoc.markModified('chat_nachrichten');
    } else if (status === STUDIO_FREIGABE_STATUS.ABGLEHNT) {
        caseDoc.chat_nachrichten.push({
            von: 'studio',
            typ: 'system',
            text: FREIGABE_CHAT_ABGELEHNT,
            datum: now,
            gelesen: false,
        });
        caseDoc.markModified('chat_nachrichten');
    }

    await caseDoc.save();

    const anamnesis = await Anamnesis.findOne({ case: caseDoc._id });
    if (anamnesis) {
        appendAudit(anamnesis, {
            typ: 'freigabe_update',
            von_status: previous,
            nach_status: status,
            notiz,
            grund,
            bearbeitet_von: label,
            bearbeitet_von_id: req.user._id,
            zeitstempel: now,
            details: `Studio-Freigabe: ${previous} → ${status}`,
        });
        await anamnesis.save();
    }

    res.status(200).json({
        success: true,
        message: 'Studio freigabe updated',
        data: {
            studio_freigabe: caseDoc.studio_freigabe,
            anamnesis: anamnesis ? formatAnamnesis(anamnesis, caseDoc) : null,
        },
    });
});

module.exports = {
    getCaseAnamnesis,
    previewCaseAnamnesis,
    upsertCaseAnamnesis,
    updateKlaerung,
    updateStudioFreigabe,
};

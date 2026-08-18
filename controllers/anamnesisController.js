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
    formatAnamnesisAnswerRows,
    diffAnamnesisAnswers,
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

const caseLabelOf = (caseDoc) =>
    caseDoc?.bodyLabel || caseDoc?.tc_title || caseDoc?.caseId || '';

const stripSignature = (entry) => {
    if (!entry) return entry;
    const copy = { ...entry };
    if (copy.bestaetigung) {
        copy.bestaetigung = {
            ...copy.bestaetigung,
            unterschrift_data: copy.bestaetigung.unterschrift_data ? '[stored]' : '',
            hat_unterschrift: Boolean(copy.bestaetigung.unterschrift_data),
        };
    }
    return copy;
};

const formatHistoryEntry = (entry, includeSignature) => {
    const raw = entry.toObject ? entry.toObject() : { ...entry };
    const formatted = includeSignature ? raw : stripSignature(raw);
    return {
        ...formatted,
        answer_rows: formatted.antworten_snapshot
            ? formatAnamnesisAnswerRows(formatted.antworten_snapshot)
            : undefined,
    };
};

const formatAnamnesis = (doc, caseDoc = null, { includeSignatures = false } = {}) => {
    const payload = doc.toObject ? doc.toObject() : { ...doc };
    const klaerung = payload.klaerung || {};
    const evaluation = buildAnamnesisEvaluation(payload.antworten || {}, klaerung);
    const history = (payload.medical_history || []).map((entry) =>
        formatHistoryEntry(entry, includeSignatures)
    );

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
        answer_rows: formatAnamnesisAnswerRows(payload.antworten || {}),
        wiederholungen: payload.wiederholungen,
        statuswechsel: payload.statuswechsel,
        medical_history: history,
        klaerung,
        audit_log: payload.audit_log || [],
        filled: evaluation.filled,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
    };
};

const findPreviousAnamnesis = async (customerId, excludeCaseId) => {
    const otherCases = await Case.find({
        customer: customerId,
        _id: { $ne: excludeCaseId },
        anamnesis_complete: true,
    })
        .select('_id caseId bodyLabel tc_title')
        .sort({ updatedAt: -1 })
        .limit(20)
        .lean();

    if (!otherCases.length) return null;

    const anamnesis = await Anamnesis.findOne({
        case: { $in: otherCases.map((c) => c._id) },
    })
        .sort({ updatedAt: -1 })
        .lean();

    if (!anamnesis || !isAnamnesisComplete(anamnesis.antworten || {})) return null;

    const sourceCase = otherCases.find((c) => String(c._id) === String(anamnesis.case));
    return {
        case_id: String(anamnesis.case),
        case_label: caseLabelOf(sourceCase),
        case_code: sourceCase?.caseId || '',
        filled_at: anamnesis.antworten?.zeitstempel || anamnesis.updatedAt,
        antworten: anamnesis.antworten,
        answer_rows: formatAnamnesisAnswerRows(anamnesis.antworten || {}),
    };
};

const buildCustomerMedicalTimeline = async (customerId, { includeSignatures = false } = {}) => {
    const cases = await Case.find({ customer: customerId })
        .select('_id caseId bodyLabel tc_title')
        .lean();
    if (!cases.length) return [];

    const byId = new Map(cases.map((c) => [String(c._id), c]));
    const docs = await Anamnesis.find({ case: { $in: cases.map((c) => c._id) } })
        .select('case antworten medical_history audit_log createdAt')
        .lean();

    const events = [];
    for (const doc of docs) {
        const source = byId.get(String(doc.case));
        const label = caseLabelOf(source);
        const history = Array.isArray(doc.medical_history) ? doc.medical_history : [];
        if (history.length) {
            for (const entry of history) {
                events.push({
                    ...formatHistoryEntry(entry, includeSignatures),
                    case_id: String(doc.case),
                    case_label: label,
                    case_code: source?.caseId || '',
                });
            }
        } else if (doc.antworten?.zeitstempel) {
            events.push({
                typ: 'submitted',
                zeitstempel: doc.antworten.zeitstempel,
                details: 'Anamnese eingereicht',
                case_id: String(doc.case),
                case_label: label,
                case_code: source?.caseId || '',
                hat_unterschrift: false,
            });
        }
    }

    events.sort((a, b) => new Date(b.zeitstempel || 0) - new Date(a.zeitstempel || 0));
    return events;
};

const sanitizeCopiedAnswers = (answers = {}) => {
    const {
        zeitstempel,
        ausgefuellt_im_studio,
        mitarbeiter,
        ...rest
    } = answers;
    return rest;
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

    await assertCaseAccess(req.user, caseDoc);

    const includeSignatures = isStudio(req.user.role) || isAdmin(req.user.role);
    let anamnesis = await Anamnesis.findOne({ case: caseDoc._id });

    if (anamnesis) {
        await syncAmpelIfStale(anamnesis);
        anamnesis = await Anamnesis.findById(anamnesis._id);
    }

    const [previous_anamnesis, customer_medical_timeline] = await Promise.all([
        findPreviousAnamnesis(caseDoc.customer, caseDoc._id),
        buildCustomerMedicalTimeline(caseDoc.customer, { includeSignatures }),
    ]);

    const payload = anamnesis
        ? formatAnamnesis(anamnesis, caseDoc, { includeSignatures })
        : {
              filled: false,
              antworten: null,
              answer_rows: [],
              medical_history: [],
          };

    res.status(200).json({
        success: true,
        data: {
            ...payload,
            previous_anamnesis: payload.filled ? null : previous_anamnesis,
            customer_medical_timeline,
        },
    });
});

const previewCaseAnamnesis = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseAccess(req.user, caseDoc);

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

    await assertCaseAccess(req.user, caseDoc);

    const {
        antworten: bodyAnswers,
        reuse_previous = false,
        gesundheit_unveraendert,
        previous_case_id,
        bestaetigung,
    } = req.body;

    const previous = await findPreviousAnamnesis(caseDoc.customer, caseDoc._id);
    const confirmingUnchanged = reuse_previous && gesundheit_unveraendert === true;

    let antworten = bodyAnswers;
    if (confirmingUnchanged) {
        const source =
            previous_case_id && previous?.case_id === previous_case_id ? previous : previous;
        if (!source?.antworten) {
            throw new ApiError(400, 'No previous medical check found to confirm');
        }
        if (!bestaetigung?.unterschrift_data) {
            throw new ApiError(400, 'Signature is required to confirm unchanged medical information');
        }
        antworten = sanitizeCopiedAnswers(source.antworten);
    }

    if (!isAnamnesisComplete(antworten)) {
        throw new ApiError(400, 'All anamnesis questions must be answered');
    }

    const { ampel_status, orange_keys, rote_keys } = computeAmpel(antworten);
    const now = new Date();
    const includeSignatures = isStudio(req.user.role) || isAdmin(req.user.role);

    const enrichedAntworten = {
        ...antworten,
        zeitstempel: now.toISOString(),
        ausgefuellt_im_studio: antworten.ausgefuellt_im_studio ?? isStudio(req.user.role),
        mitarbeiter: antworten.mitarbeiter || req.user.email,
    };

    let anamnesis = await Anamnesis.findOne({ case: caseDoc._id });
    const isNew = !anamnesis;
    const baselineAnswers = anamnesis?.antworten || previous?.antworten;
    const changes = baselineAnswers
        ? diffAnamnesisAnswers(baselineAnswers, enrichedAntworten)
        : [];

    const historyTyp = confirmingUnchanged
        ? 'confirmed_unchanged'
        : !isNew || previous
          ? 'updated'
          : 'submitted';

    const historyEntry = {
        typ: historyTyp,
        zeitstempel: now,
        quelle_case_id: previous?.case_id || null,
        quelle_case_label: previous?.case_label || '',
        gesundheit_unveraendert: confirmingUnchanged,
        aenderungen: confirmingUnchanged ? [] : changes,
        details: confirmingUnchanged
            ? 'Gesundheitszustand unverändert bestätigt'
            : historyTyp === 'updated'
              ? `Medizinische Angaben aktualisiert${changes.length ? ` (${changes.length} Änderung(en))` : ''}`
              : 'Anamnese eingereicht',
        antworten_snapshot: enrichedAntworten,
        bestaetigung: bestaetigung
            ? {
                  name: bestaetigung.name || staffLabel(req.user),
                  zeitstempel: now,
                  unterschrift_data: bestaetigung.unterschrift_data,
                  hat_unterschrift: true,
                  text: confirmingUnchanged
                      ? 'Ich bestätige, dass meine medizinischen Angaben unverändert und aktuell sind.'
                      : 'Ich bestätige, dass die aktualisierten medizinischen Angaben korrekt sind.',
              }
            : null,
        bearbeitet_von: staffLabel(req.user),
        bearbeitet_von_id: req.user._id,
    };

    if (isNew) {
        anamnesis = await Anamnesis.create({
            case: caseDoc._id,
            ampel_status,
            orange_fragen: orange_keys,
            rote_fragen: rote_keys,
            antworten: enrichedAntworten,
            klaerung: {},
            medical_history: [historyEntry],
            audit_log: [
                {
                    typ: confirmingUnchanged ? 'anamnesis_confirmed' : 'anamnesis_submitted',
                    details: historyEntry.details,
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
            details: historyEntry.details,
            bearbeitet_von: staffLabel(req.user),
            bearbeitet_von_id: req.user._id,
            zeitstempel: now,
            ampel_status,
            previous_ampel: previousAmpel,
        });

        if (!Array.isArray(anamnesis.medical_history)) anamnesis.medical_history = [];
        anamnesis.medical_history.push(historyEntry);
        anamnesis.markModified('medical_history');

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

    const timeline = await buildCustomerMedicalTimeline(caseDoc.customer, { includeSignatures });

    res.status(isNew ? 201 : 200).json({
        success: true,
        message: isNew ? 'Anamnesis created' : 'Anamnesis updated',
        data: {
            ...formatAnamnesis(responseDoc, caseDoc, { includeSignatures }),
            previous_anamnesis: null,
            customer_medical_timeline: timeline,
        },
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
    await assertCaseAccess(req.user, caseDoc);

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
    await assertCaseAccess(req.user, caseDoc);

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

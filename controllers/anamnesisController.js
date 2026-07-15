const Case = require('../models/caseModel');
const Studio = require('../models/studioModel');
const Anamnesis = require('../models/anamnesisModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertCaseAccess, isStudio } = require('../utils/accessHelpers');
const {
    computeAmpel,
    buildAnamnesisEvaluation,
    isAnamnesisComplete,
} = require('../utils/anamnesisEngine');
const { vergebeElaycoins } = require('../utils/elaycoinEngine');
const { STUDIO_FREIGABE_STATUS } = require('../config/constants');

const STUDIO_FREIGABE_CHAT_TEXT =
    'Deine Anamnese wurde erfolgreich abgeschlossen. Aufgrund deiner Angaben prüft das Studio deine Unterlagen und gibt dir schnellstmöglich Bescheid. Bei dringenden Fragen wende dich bitte an dein Studio.';

const formatAnamnesis = (doc) => {
    const payload = doc.toObject ? doc.toObject() : { ...doc };
    const evaluation = buildAnamnesisEvaluation(payload.antworten || {});

    return {
        id: payload._id,
        case: payload.case,
        ampel_status: evaluation.ampel_status,
        orange_fragen: evaluation.orange_fragen,
        rote_fragen: evaluation.rote_fragen,
        inline_hints: evaluation.inline_hints,
        has_ko_flags: evaluation.has_ko_flags,
        studio_freigabe: evaluation.studio_freigabe,
        summary: evaluation.summary,
        open_medical_flags_count: evaluation.open_medical_flags_count,
        antworten: payload.antworten,
        wiederholungen: payload.wiederholungen,
        statuswechsel: payload.statuswechsel,
        filled: evaluation.filled,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
    };
};

const syncAmpelIfStale = async (anamnesis) => {
    const ampel = computeAmpel(anamnesis.antworten || {});

    if (
        anamnesis.ampel_status === ampel.ampel_status &&
        JSON.stringify(anamnesis.orange_fragen) === JSON.stringify(ampel.orange_keys) &&
        JSON.stringify(anamnesis.rote_fragen) === JSON.stringify(ampel.rote_keys)
    ) {
        return anamnesis;
    }

    anamnesis.ampel_status = ampel.ampel_status;
    anamnesis.orange_fragen = ampel.orange_keys;
    anamnesis.rote_fragen = ampel.rote_keys;
    await anamnesis.save();

    return anamnesis;
};

const syncCaseMedicalFlags = async (caseDoc, answers) => {
    const evaluation = buildAnamnesisEvaluation(answers);
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
        data: anamnesis ? formatAnamnesis(anamnesis) : null,
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

        anamnesis.ampel_status = ampel_status;
        anamnesis.orange_fragen = orange_keys;
        anamnesis.rote_fragen = rote_keys;
        anamnesis.antworten = enrichedAntworten;
        anamnesis.markModified('antworten');
        await anamnesis.save();
    }

    await syncCaseMedicalFlags(caseDoc, enrichedAntworten);

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
        data: formatAnamnesis(responseDoc),
        case_flags: {
            medical_flag_level: caseDoc.medical_flag_level,
            open_medical_flags_count: caseDoc.open_medical_flags_count,
            anamnesis_complete: caseDoc.anamnesis_complete,
            studio_freigabe: caseDoc.studio_freigabe,
        },
    });
});

module.exports = {
    getCaseAnamnesis,
    previewCaseAnamnesis,
    upsertCaseAnamnesis,
};

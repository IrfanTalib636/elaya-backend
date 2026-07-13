const Case = require('../models/caseModel');
const Studio = require('../models/studioModel');
const Anamnesis = require('../models/anamnesisModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertCaseAccess, isStudio } = require('../utils/accessHelpers');
const { computeAmpel, isAnamnesisComplete } = require('../utils/anamnesisEngine');
const { vergebeElaycoins } = require('../utils/elaycoinEngine');

const formatAnamnesis = (doc) => {
    const payload = doc.toObject ? doc.toObject() : { ...doc };
    const ampel = computeAmpel(payload.antworten || {});

    return {
        id: payload._id,
        case: payload.case,
        ampel_status: ampel.ampel_status,
        orange_fragen: ampel.orange_fragen,
        rote_fragen: ampel.rote_fragen,
        antworten: payload.antworten,
        wiederholungen: payload.wiederholungen,
        statuswechsel: payload.statuswechsel,
        filled: isAnamnesisComplete(payload.antworten),
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

    const responseDoc = anamnesis.toObject ? anamnesis.toObject() : { ...anamnesis };
    responseDoc.antworten = enrichedAntworten;
    responseDoc.ampel_status = ampel_status;
    responseDoc.orange_fragen = orange_keys;
    responseDoc.rote_fragen = rote_keys;

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
    });
});

module.exports = {
    getCaseAnamnesis,
    upsertCaseAnamnesis,
};

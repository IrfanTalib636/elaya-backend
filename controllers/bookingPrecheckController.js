const Case = require('../models/caseModel');
const Anamnesis = require('../models/anamnesisModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertCaseAccess } = require('../utils/accessHelpers');
const {
    buildBookingPrecheckForm,
    validateBookingPrecheck,
    computeAvailability,
} = require('../utils/bookingPrecheckEngine');

const loadCaseAndAnamnesis = async (caseId, user) => {
    const caseDoc = await Case.findById(caseId);
    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }
    await assertCaseAccess(user, caseDoc);

    const anamnesis = await Anamnesis.findOne({ case: caseDoc._id });
    return { caseDoc, anamnesis };
};

/** GET /cases/:id/booking-precheck — PS_01 form schema for mobile booking flow */
const getBookingPrecheck = asyncHandler(async (req, res) => {
    const { caseDoc, anamnesis } = await loadCaseAndAnamnesis(req.params.id, req.user);

    res.status(200).json({
        success: true,
        data: buildBookingPrecheckForm(caseDoc, anamnesis),
    });
});

/** POST /cases/:id/booking-precheck/preview — validate PS_01 answers before calendar */
const previewBookingPrecheck = asyncHandler(async (req, res) => {
    const { caseDoc, anamnesis } = await loadCaseAndAnamnesis(req.params.id, req.user);

    const {
        consultation_only: consultationOnly = false,
        pre_session: preSession = {},
        ko_answers: koAnswers = {},
        wiederholungen = {},
        wiederholungen_confirmed: wiederholungenConfirmed = false,
        ko_signature: koSignature = null,
    } = req.body;

    const result = validateBookingPrecheck({
        caseDoc,
        anamnesis,
        consultationOnly,
        preSession,
        koAnswers,
        wiederholungen,
        wiederholungenConfirmed,
        koSignature,
    });

    let availabilityHint = null;
    if (!consultationOnly && result.pre_session_check?.uv_exposition) {
        availabilityHint = await computeAvailability({
            activeCaseId: caseDoc._id,
            customerId: caseDoc.customer,
            consultationOnly: false,
            preSessionCheck: result.pre_session_check,
        });
    }

    res.status(200).json({
        success: true,
        data: {
            can_proceed: result.can_proceed,
            blocks: result.blocks,
            requires_ko_signature: result.requires_ko_signature,
            changed_ko_keys: result.changed_ko_keys,
            pre_session_check: result.pre_session_check,
            block_dates: {
                uvBlockDate: result.block_dates.uvBlockDate,
                medicationBlockDate: result.block_dates.medicationBlockDate,
            },
            availability_hint: availabilityHint,
        },
    });
});

module.exports = {
    getBookingPrecheck,
    previewBookingPrecheck,
    loadCaseAndAnamnesis,
};

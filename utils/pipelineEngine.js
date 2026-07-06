const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const Customer = require('../models/customerModel');
const {
    PIPELINE_STUFE,
    APPOINTMENT_STATUS,
    APPOINTMENT_TYPE,
} = require('../config/constants');

const CANCELLED_STATUSES = [
    APPOINTMENT_STATUS.STORNIERT,
    APPOINTMENT_STATUS.CANCELLED,
];

const CONSULTATION_TYPES = [
    APPOINTMENT_TYPE.BERATUNG,
    APPOINTMENT_TYPE.FIRST,
];

/**
 * Compute CRM pipeline stage from cases, appointments, and sessions.
 * Maps prototype berechneLeadStufe logic to the 4 M2 pipeline_stufe values.
 */
const computePipelineStufe = async (customerId) => {
    const cases = await Case.find({ customer: customerId })
        .select('_id status sessionsDone unterschrift')
        .lean();

    if (cases.length === 0) {
        return PIPELINE_STUFE.NEU;
    }

    const hasFinalizedSession = await Session.exists({
        customer: customerId,
        is_draft: false,
        is_no_show: false,
    });

    if (hasFinalizedSession || cases.some((c) => (c.sessionsDone ?? 0) > 0)) {
        return PIPELINE_STUFE.BEHANDLUNG_AKTIV;
    }

    const now = new Date();

    const hasFutureAppointment = await Appointment.exists({
        customer: customerId,
        date: { $gte: now },
        status: { $nin: CANCELLED_STATUSES },
    });

    if (hasFutureAppointment) {
        return PIPELINE_STUFE.BERATUNG_GEPLANT;
    }

    const hasSignature = cases.some((c) => c.unterschrift?.zeitstempel);

    const hadConsultation = await Appointment.exists({
        customer: customerId,
        date: { $lt: now },
        status: { $nin: CANCELLED_STATUSES },
        $or: [
            { type: { $in: CONSULTATION_TYPES } },
            { consultationOnly: true },
        ],
    });

    if (hasSignature || hadConsultation) {
        return PIPELINE_STUFE.BERATUNG_ERLEDIGT;
    }

    return PIPELINE_STUFE.NEU;
};

/** Persist computed stage when it changed; returns updated customer doc fields. */
const syncCustomerPipeline = async (customerId) => {
    const customer = await Customer.findById(customerId);

    if (!customer) {
        return null;
    }

    const computed = await computePipelineStufe(customerId);

    if (customer.pipeline_stufe !== computed) {
        customer.pipeline_stufe = computed;
        customer.stufe_seit = new Date();
        await customer.save();
    }

    return customer;
};

/** Sync pipeline for every customer in a studio. Returns count updated. */
const syncStudioPipeline = async (studioId) => {
    const customers = await Customer.find({ aktuelle_firma_id: studioId }).select('_id pipeline_stufe');
    let updated = 0;

    for (const c of customers) {
        const before = c.pipeline_stufe;
        const after = await syncCustomerPipeline(c._id);
        if (after && before !== after.pipeline_stufe) {
            updated += 1;
        }
    }

    return updated;
};

const daysSince = (date) => {
    if (!date) return 0;
    const ms = Date.now() - new Date(date).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
};

module.exports = {
    computePipelineStufe,
    syncCustomerPipeline,
    syncStudioPipeline,
    daysSince,
    PIPELINE_ORDER: [
        PIPELINE_STUFE.NEU,
        PIPELINE_STUFE.BERATUNG_GEPLANT,
        PIPELINE_STUFE.BEHANDLUNG_AKTIV,
        PIPELINE_STUFE.BERATUNG_ERLEDIGT,
    ],
};

const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const Customer = require('../models/customerModel');
const { StudioLead, STUDIO_LEAD_STATUS, normalizeLeadStatus } = require('../models/studioLeadModel');
const { CASE_STATUS, APPOINTMENT_STATUS } = require('../config/constants');
const {
    CUSTOMER_FUNNEL_STAGE,
    STUDIO_FUNNEL_STAGE,
    STUDIO_MISSING_STEP,
    CUSTOMER_FUNNEL_ACTION,
    STUDIO_FUNNEL_ACTION,
    CUSTOMER_DROPOFF,
    STUDIO_DROPOFF,
    PLATFORM_CRM_STUCK_DAYS,
    customerFunnelStageIndex,
} = require('../config/platformCrmConfig');

const CANCELLED_APPOINTMENT = [
    APPOINTMENT_STATUS.STORNIERT,
    APPOINTMENT_STATUS.CANCELLED,
];

const daysSince = (date) => {
    if (!date) return 0;
    const ms = Date.now() - new Date(date).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
};

const maxDate = (...dates) => {
    let best = null;
    for (const d of dates) {
        if (!d) continue;
        const t = new Date(d).getTime();
        if (Number.isNaN(t)) continue;
        if (best === null || t > best) best = t;
    }
    return best === null ? null : new Date(best);
};

const computeCustomerFunnel = async (customerId) => {
    const customer = await Customer.findById(customerId)
        .select('aktuelle_firma_id registriert_am createdAt updatedAt platform_crm')
        .lean();

    if (!customer) {
        return null;
    }

    const [cases, appointments, sessions] = await Promise.all([
        Case.find({ customer: customerId }).select('status createdAt updatedAt').lean(),
        Appointment.find({ customer: customerId })
            .select('status date createdAt updatedAt')
            .lean(),
        Session.find({ customer: customerId })
            .select('is_draft is_no_show treatment_date createdAt updatedAt')
            .lean(),
    ]);

    const hasStudio = !!customer.aktuelle_firma_id;
    const draftCases = cases.filter((c) => c.status === CASE_STATUS.DRAFT);
    const nonDraftCases = cases.filter((c) => c.status !== CASE_STATUS.DRAFT);
    const hasDraftCase = draftCases.length > 0;
    const hasCreatedCase = nonDraftCases.length > 0;
    const openAppointments = appointments.filter(
        (a) => !CANCELLED_APPOINTMENT.includes(a.status)
    );
    const cancelledAppointments = appointments.filter((a) =>
        CANCELLED_APPOINTMENT.includes(a.status)
    );
    const hasOpenAppointment = openAppointments.length > 0;
    const finalizedSessions = sessions.filter((s) => !s.is_draft && !s.is_no_show);
    const hasFirstTreatment = finalizedSessions.length > 0;
    const firstSessionAt =
        finalizedSessions
            .map((s) => s.treatment_date || s.createdAt)
            .filter(Boolean)
            .sort((a, b) => new Date(a) - new Date(b))[0] || null;

    const activeCases = nonDraftCases.filter((c) => c.status === CASE_STATUS.ACTIVE);
    const completedCases = nonDraftCases.filter((c) => c.status === CASE_STATUS.COMPLETED);
    const allNonDraftCompleted =
        hasCreatedCase && completedCases.length === nonDraftCases.length;

    let funnel_stage = CUSTOMER_FUNNEL_STAGE.REGISTERED;
    if (hasStudio) funnel_stage = CUSTOMER_FUNNEL_STAGE.STUDIO_SELECTED;
    if (hasDraftCase && !hasCreatedCase) {
        funnel_stage = CUSTOMER_FUNNEL_STAGE.CASE_STARTED;
    }
    if (hasCreatedCase) funnel_stage = CUSTOMER_FUNNEL_STAGE.CASE_CREATED;
    if (hasOpenAppointment) funnel_stage = CUSTOMER_FUNNEL_STAGE.APPOINTMENT_BOOKED;
    if (hasFirstTreatment) funnel_stage = CUSTOMER_FUNNEL_STAGE.FIRST_TREATMENT;
    if (hasFirstTreatment && (activeCases.length > 0 || !allNonDraftCompleted)) {
        // After first session: active if still in treatment; completed only when all finalized cases done
        if (!allNonDraftCompleted) {
            funnel_stage = CUSTOMER_FUNNEL_STAGE.TREATMENT_ACTIVE;
        }
    }
    if (allNonDraftCompleted && hasFirstTreatment) {
        funnel_stage = CUSTOMER_FUNNEL_STAGE.COMPLETED;
    } else if (allNonDraftCompleted && !hasFirstTreatment) {
        // Edge: cases closed without session — still mark completed
        funnel_stage = CUSTOMER_FUNNEL_STAGE.COMPLETED;
    }

    const last_activity_at =
        maxDate(
            customer.updatedAt,
            customer.registriert_am,
            customer.createdAt,
            ...cases.map((c) => c.updatedAt || c.createdAt),
            ...appointments.map((a) => a.updatedAt || a.date || a.createdAt),
            ...sessions.map((s) => s.updatedAt || s.treatment_date || s.createdAt)
        ) || new Date();

    const prev = customer.platform_crm || {};
    const stageChanged = prev.funnel_stage !== funnel_stage;
    const stage_entered_at = stageChanged
        ? new Date()
        : prev.stage_entered_at
          ? new Date(prev.stage_entered_at)
          : new Date();

    const completed_at =
        funnel_stage === CUSTOMER_FUNNEL_STAGE.COMPLETED
            ? prev.completed_at
                ? new Date(prev.completed_at)
                : stageChanged
                  ? new Date()
                  : prev.completed_at || new Date()
            : null;

    const dropoffs = [];
    if (!hasStudio) dropoffs.push(CUSTOMER_DROPOFF.REGISTERED_NO_STUDIO);
    if (hasStudio && !hasDraftCase && !hasCreatedCase) {
        dropoffs.push(CUSTOMER_DROPOFF.STUDIO_NO_CASE_STARTED);
    }
    if (hasDraftCase && !hasCreatedCase) {
        dropoffs.push(CUSTOMER_DROPOFF.CASE_STARTED_NOT_CREATED);
    }
    if (hasCreatedCase && !hasOpenAppointment && cancelledAppointments.length === 0) {
        dropoffs.push(CUSTOMER_DROPOFF.CASE_CREATED_NO_APPOINTMENT);
    }
    if (cancelledAppointments.length > 0 && !hasOpenAppointment) {
        dropoffs.push(CUSTOMER_DROPOFF.APPOINTMENT_CANCELLED_NOT_REBOOKED);
    }

    return {
        funnel_stage,
        stage_entered_at,
        last_activity_at,
        cases_count: cases.length,
        has_draft_case: hasDraftCase,
        has_open_appointment: hasOpenAppointment,
        first_session_at: firstSessionAt ? new Date(firstSessionAt) : null,
        completed_at,
        days_in_stage: daysSince(stage_entered_at),
        recommended_action: CUSTOMER_FUNNEL_ACTION[funnel_stage] || '',
        dropoffs,
        stage_index: customerFunnelStageIndex(funnel_stage),
    };
};

/** Persist computed platform_crm on Customer. Returns snapshot or null. */
const syncCustomerPlatformCrm = async (customerId) => {
    const snapshot = await computeCustomerFunnel(customerId);
    if (!snapshot) return null;

    const platform_crm = {
        funnel_stage: snapshot.funnel_stage,
        stage_entered_at: snapshot.stage_entered_at,
        last_activity_at: snapshot.last_activity_at,
        cases_count: snapshot.cases_count,
        has_draft_case: snapshot.has_draft_case,
        has_open_appointment: snapshot.has_open_appointment,
        first_session_at: snapshot.first_session_at,
        completed_at: snapshot.completed_at,
    };

    await Customer.updateOne({ _id: customerId }, { $set: { platform_crm } });
    return snapshot;
};

const syncCustomerPlatformCrmSafe = async (customerId) => {
    try {
        return await syncCustomerPlatformCrm(customerId);
    } catch (err) {
        console.error('[platformFunnel] customer sync failed', String(customerId), err.message);
        return null;
    }
};

const computeStudioLeadMissingSteps = (lead) => {
    const missing = [];
    const status = normalizeLeadStatus(lead.status);
    const vertrag = lead.vertrag || {};
    const abo = lead.abo || {};

    if (!String(lead.email || '').trim() || !String(lead.telefon || '').trim()) {
        missing.push(STUDIO_MISSING_STEP.PROFILE);
    }

    const needsContract = [
        STUDIO_LEAD_STATUS.LEAD,
        STUDIO_LEAD_STATUS.CONTRACT,
        STUDIO_LEAD_STATUS.CONTRACT_SENT,
        STUDIO_LEAD_STATUS.CONTRACT_SIGNED,
        STUDIO_LEAD_STATUS.ONBOARDING,
    ].includes(status);
    if (needsContract && vertrag.status !== 'UNTERSCHRIEBEN') {
        missing.push(STUDIO_MISSING_STEP.VERTRAG);
    }

    const needsPayment = [
        STUDIO_LEAD_STATUS.CONTRACT_SENT,
        STUDIO_LEAD_STATUS.CONTRACT_SIGNED,
        STUDIO_LEAD_STATUS.ONBOARDING,
        STUDIO_LEAD_STATUS.ACTIVE,
    ].includes(status);
    if (needsPayment && (!abo.zahlungsweg || abo.zahlungsweg === 'none')) {
        missing.push(STUDIO_MISSING_STEP.ZAHLUNG);
    }

    const needsVerification = [
        STUDIO_LEAD_STATUS.CONTRACT_SENT,
        STUDIO_LEAD_STATUS.CONTRACT_SIGNED,
        STUDIO_LEAD_STATUS.ONBOARDING,
    ].includes(status);
    if (needsVerification) {
        missing.push(STUDIO_MISSING_STEP.VERIFICATION);
    }

    return [...new Set(missing)];
};

const mapStudioLeadToFunnelStage = (lead, missingSteps) => {
    const status = normalizeLeadStatus(lead.status);

    if (status === STUDIO_LEAD_STATUS.ACTIVE) {
        return STUDIO_FUNNEL_STAGE.ACTIVE;
    }
    if (status === STUDIO_LEAD_STATUS.DEACTIVATED || status === STUDIO_LEAD_STATUS.REJECTED) {
        return STUDIO_FUNNEL_STAGE.LEAD;
    }
    if (status === STUDIO_LEAD_STATUS.ONBOARDING) {
        return missingSteps.length > 0
            ? STUDIO_FUNNEL_STAGE.ONBOARDING_INCOMPLETE
            : STUDIO_FUNNEL_STAGE.ONBOARDING_STARTED;
    }
    if (status === STUDIO_LEAD_STATUS.CONTRACT_SIGNED) {
        return STUDIO_FUNNEL_STAGE.ONBOARDING_STARTED;
    }
    if (
        status === STUDIO_LEAD_STATUS.CONTRACT_SENT ||
        status === STUDIO_LEAD_STATUS.CONTRACT
    ) {
        return STUDIO_FUNNEL_STAGE.CONTRACT_PENDING;
    }

    // lead — split by profile completeness
    const hasProfile =
        String(lead.firma || '').trim() &&
        String(lead.email || '').trim() &&
        String(lead.telefon || '').trim();

    if (!hasProfile) {
        return STUDIO_FUNNEL_STAGE.REGISTRATION_STARTED;
    }
    // Complete lead pending contract / verification lane
    return STUDIO_FUNNEL_STAGE.REGISTRATION_COMPLETED;
};

const refineStudioStageWithLinkedStudio = (stage, linkedStudio) => {
    if (!linkedStudio) return stage;
    if (linkedStudio.status === 'ausstehend') {
        if (
            stage === STUDIO_FUNNEL_STAGE.REGISTRATION_COMPLETED ||
            stage === STUDIO_FUNNEL_STAGE.REGISTRATION_STARTED ||
            stage === STUDIO_FUNNEL_STAGE.LEAD
        ) {
            return STUDIO_FUNNEL_STAGE.VERIFICATION_PENDING;
        }
    }
    if (linkedStudio.status === 'aktiv' && stage !== STUDIO_FUNNEL_STAGE.ACTIVE) {
        return STUDIO_FUNNEL_STAGE.ACTIVE;
    }
    return stage;
};

const computeStudioLeadFunnel = async (leadId) => {
    const lead = await StudioLead.findById(leadId).lean();
    if (!lead) return null;

    const prev = lead.platform_crm || {};
    const missing_steps = computeStudioLeadMissingSteps(lead);

    let linkedStudio = null;
    if (prev.linked_studio_id) {
        const Studio = require('../models/studioModel');
        linkedStudio = await Studio.findById(prev.linked_studio_id)
            .select('status updatedAt')
            .lean();
    }

    let funnel_stage = mapStudioLeadToFunnelStage(lead, missing_steps);
    funnel_stage = refineStudioStageWithLinkedStudio(funnel_stage, linkedStudio);

    const last_activity_at =
        maxDate(lead.updatedAt, lead.createdAt, linkedStudio?.updatedAt) || new Date();

    const stageChanged = prev.funnel_stage !== funnel_stage;
    const stage_entered_at = stageChanged
        ? new Date()
        : prev.stage_entered_at
          ? new Date(prev.stage_entered_at)
          : new Date(lead.createdAt || Date.now());

    const days_in_stage = daysSince(stage_entered_at);
    const dropoffs = [];
    if (days_in_stage >= PLATFORM_CRM_STUCK_DAYS) {
        if (
            funnel_stage === STUDIO_FUNNEL_STAGE.LEAD ||
            funnel_stage === STUDIO_FUNNEL_STAGE.REGISTRATION_STARTED ||
            funnel_stage === STUDIO_FUNNEL_STAGE.REGISTRATION_COMPLETED
        ) {
            dropoffs.push(STUDIO_DROPOFF.LEAD_STALLED);
        }
        if (funnel_stage === STUDIO_FUNNEL_STAGE.VERIFICATION_PENDING) {
            dropoffs.push(STUDIO_DROPOFF.VERIFICATION_STALLED);
        }
        if (funnel_stage === STUDIO_FUNNEL_STAGE.CONTRACT_PENDING) {
            dropoffs.push(STUDIO_DROPOFF.CONTRACT_STALLED);
        }
        if (
            funnel_stage === STUDIO_FUNNEL_STAGE.ONBOARDING_STARTED ||
            funnel_stage === STUDIO_FUNNEL_STAGE.ONBOARDING_INCOMPLETE
        ) {
            dropoffs.push(STUDIO_DROPOFF.ONBOARDING_STALLED);
        }
    }

    return {
        funnel_stage,
        stage_entered_at,
        last_activity_at,
        linked_studio_id: prev.linked_studio_id || null,
        missing_steps,
        days_in_stage,
        recommended_action: STUDIO_FUNNEL_ACTION[funnel_stage] || '',
        dropoffs,
    };
};

const syncStudioLeadPlatformCrm = async (leadId, { linked_studio_id } = {}) => {
    if (linked_studio_id !== undefined) {
        await StudioLead.updateOne(
            { _id: leadId },
            { $set: { 'platform_crm.linked_studio_id': linked_studio_id } }
        );
    }

    const snapshot = await computeStudioLeadFunnel(leadId);
    if (!snapshot) return null;

    const platform_crm = {
        funnel_stage: snapshot.funnel_stage,
        stage_entered_at: snapshot.stage_entered_at,
        last_activity_at: snapshot.last_activity_at,
        linked_studio_id: snapshot.linked_studio_id || linked_studio_id || null,
        missing_steps: snapshot.missing_steps,
    };

    await StudioLead.updateOne({ _id: leadId }, { $set: { platform_crm } });
    return snapshot;
};

const syncStudioLeadPlatformCrmSafe = async (leadId, opts) => {
    try {
        return await syncStudioLeadPlatformCrm(leadId, opts);
    } catch (err) {
        console.error('[platformFunnel] studio lead sync failed', String(leadId), err.message);
        return null;
    }
};

const backfillPlatformCrm = async ({ batchSize = 100, onProgress } = {}) => {
    const result = {
        customers: { total: 0, synced: 0, failed: 0 },
        leads: { total: 0, synced: 0, failed: 0 },
    };

    result.customers.total = await Customer.countDocuments({});
    let customerSkip = 0;
    while (customerSkip < result.customers.total) {
        const batch = await Customer.find({})
            .select('_id')
            .sort({ _id: 1 })
            .skip(customerSkip)
            .limit(batchSize)
            .lean();
        if (batch.length === 0) break;

        for (const row of batch) {
            try {
                await syncCustomerPlatformCrm(row._id);
                result.customers.synced += 1;
            } catch {
                result.customers.failed += 1;
            }
        }
        customerSkip += batch.length;
        if (typeof onProgress === 'function') {
            onProgress({ type: 'customer', ...result.customers });
        }
    }

    result.leads.total = await StudioLead.countDocuments({});
    let leadSkip = 0;
    while (leadSkip < result.leads.total) {
        const batch = await StudioLead.find({})
            .select('_id')
            .sort({ _id: 1 })
            .skip(leadSkip)
            .limit(batchSize)
            .lean();
        if (batch.length === 0) break;

        for (const row of batch) {
            try {
                await syncStudioLeadPlatformCrm(row._id);
                result.leads.synced += 1;
            } catch {
                result.leads.failed += 1;
            }
        }
        leadSkip += batch.length;
        if (typeof onProgress === 'function') {
            onProgress({ type: 'lead', ...result.leads });
        }
    }

    return result;
};

module.exports = {
    daysSince,
    computeCustomerFunnel,
    syncCustomerPlatformCrm,
    syncCustomerPlatformCrmSafe,
    computeStudioLeadMissingSteps,
    mapStudioLeadToFunnelStage,
    computeStudioLeadFunnel,
    syncStudioLeadPlatformCrm,
    syncStudioLeadPlatformCrmSafe,
    backfillPlatformCrm,
};

/**
 * Customer-level medical clearance (doctor's certificate) workflow.
 *
 * Upload alone never unlocks treatment booking — only studio verification does.
 * Consultation-only appointments stay bookable without clearance.
 */

const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Case = require('../models/caseModel');
const FileAsset = require('../models/fileAssetModel');
const CrmTask = require('../models/crmTaskModel');
const ApiError = require('./ApiError');
const { USER_ROLES } = require('../config/constants');
const { CRM_TASK_TYP, CRM_TASK_PRIORITAET } = require('../config/crmDefaults');
const { createForUsers } = require('../services/notificationService');
const { sendToUsers } = require('../services/pushService');
const { FILE_PURPOSE, FILE_STATUS } = require('../config/storageConfig');

/** Pre-session med key → platform condition_locks key */
const MED_TO_CONDITION_KEY = {
    antidepressiva: 'antidepressants',
    antidepressants: 'antidepressants',
    skin_acne_medication: 'skin_acne_medication',
    acne_medication: 'skin_acne_medication',
    other_unknown_medication: 'other_unknown_medication',
    illness_not_recovered: 'illness_not_recovered',
};

const CLEARANCE_STATUSES = {
    NOT_REQUIRED: 'not_required',
    REQUIRED: 'required',
    PENDING_REVIEW: 'pending_review',
    VERIFIED: 'verified',
    REJECTED: 'rejected',
};

const BLOCKING_STATUSES = new Set([
    CLEARANCE_STATUSES.REQUIRED,
    CLEARANCE_STATUSES.PENDING_REVIEW,
    CLEARANCE_STATUSES.REJECTED,
]);

const emptyClearance = () => ({
    status: CLEARANCE_STATUSES.NOT_REQUIRED,
    reasons: [],
    documents: [],
    required_since: null,
    verified_at: null,
    verified_by: null,
    verified_note: '',
    rejected_at: null,
    rejected_by: null,
    rejected_reason: '',
});

const resolveConditionLocks = (sperrfristen) => {
    const locks =
        sperrfristen?.condition_locks ||
        require('../config/platformDefaults').PLATFORM_CONFIG_DEFAULTS.sperrfristen
            .condition_locks;
    return locks && typeof locks === 'object' ? locks : {};
};

/** Med keys that need MEDICAL_CLEARANCE_REQUIRED under current platform rules. */
const clearanceRequiredMedKeys = (meds = [], sperrfristen = null) => {
    const locks = resolveConditionLocks(sperrfristen);
    const out = [];
    for (const med of meds || []) {
        if (!med || med === 'keine') continue;
        const condKey = MED_TO_CONDITION_KEY[med] || med;
        if (locks[condKey] === 'MEDICAL_CLEARANCE_REQUIRED') {
            out.push({ med_key: med, condition_key: condKey });
        }
    }
    return out;
};

/** True when antidepressiva (etc.) should use clearance instead of a day-count lock. */
const medUsesClearanceNotDateLock = (medKey, sperrfristen = null) => {
    const locks = resolveConditionLocks(sperrfristen);
    const condKey = MED_TO_CONDITION_KEY[medKey] || medKey;
    return locks[condKey] === 'MEDICAL_CLEARANCE_REQUIRED';
};

const serializeClearance = (raw, { includeDocs = true } = {}) => {
    const c = raw && typeof raw === 'object' ? raw : emptyClearance();
    const docs = includeDocs
        ? (c.documents || []).map((d) => ({
              file_id: d.file_id ? String(d.file_id) : null,
              uploaded_at: d.uploaded_at || null,
              original_name: d.original_name || '',
              mime_type: d.mime_type || '',
          }))
        : undefined;
    return {
        status: c.status || CLEARANCE_STATUSES.NOT_REQUIRED,
        reasons: Array.isArray(c.reasons) ? c.reasons : [],
        required_since: c.required_since || null,
        verified_at: c.verified_at || null,
        verified_by: c.verified_by ? String(c.verified_by) : null,
        verified_note: c.verified_note || '',
        rejected_at: c.rejected_at || null,
        rejected_by: c.rejected_by ? String(c.rejected_by) : null,
        rejected_reason: c.rejected_reason || '',
        blocks_treatment: BLOCKING_STATUSES.has(c.status || CLEARANCE_STATUSES.NOT_REQUIRED),
        ...(includeDocs ? { documents: docs } : {}),
    };
};

const treatmentBlockedByClearance = (clearance) =>
    BLOCKING_STATUSES.has(clearance?.status || CLEARANCE_STATUSES.NOT_REQUIRED);

const findStudioStaffUserIds = async (studioId) => {
    if (!studioId) return [];
    const users = await User.find({
        studio_id: studioId,
        role: { $in: [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF] },
        status: { $ne: 'gesperrt' },
    })
        .select('_id')
        .lean();
    return users.map((u) => u._id);
};

const notifyStudioClearance = async ({
    studioId,
    customerId,
    customerName,
    title,
    body,
    type = 'medical_clearance',
}) => {
    const userIds = await findStudioStaffUserIds(studioId);
    if (!userIds.length) return;

    const meta = {
        customer_id: String(customerId),
        screen: 'medical_clearance',
    };

    let created = [];
    try {
        created = await createForUsers({
            userIds,
            type,
            title,
            body,
            studioId: studioId?.toString?.() || studioId,
            meta,
        });
    } catch (err) {
        console.error('Clearance studio inbox failed:', err.message);
    }

    // Live toast on studio dashboards (bell + toast click → customer clearance)
    try {
        const { getIO } = require('../sockets/io');
        const messagingService = require('./messagingService');
        const platformMessagingService = require('./platformMessagingService');
        const io = getIO();
        if (io && studioId) {
            const sid = String(studioId);
            const envelope = {
                notification: created[0] || {
                    type,
                    title,
                    body,
                    meta,
                    unread: true,
                },
            };
            io.to(messagingService.studioRoom(sid)).emit('notification:created', envelope);
            io.to(platformMessagingService.studioRoom(sid)).emit(
                'notification:created',
                envelope
            );
        }
    } catch (err) {
        console.error('Clearance studio socket fan-out failed:', err.message);
    }

    try {
        await sendToUsers(userIds, {
            title,
            body,
            data: {
                type,
                customer_id: String(customerId),
                screen: 'medical_clearance',
            },
        });
    } catch (err) {
        console.error('Clearance studio push failed:', err.message);
    }

    const titel = title;
    const existing = await CrmTask.findOne({
        studio: studioId,
        customer: customerId,
        erledigt: false,
        titel,
    }).lean();
    if (!existing) {
        await CrmTask.create({
            studio: studioId,
            customer: customerId,
            titel,
            typ: CRM_TASK_TYP.ANRUF,
            prioritaet: CRM_TASK_PRIORITAET.HOCH,
            faellig_am: new Date(),
        });
    }
};

const notifyCustomerClearance = async ({ userId, title, body, studioId, type = 'medical_clearance', meta = null }) => {
    if (!userId) return;
    try {
        await createForUsers({
            userIds: [userId],
            type,
            title,
            body,
            studioId: studioId?.toString?.() || studioId,
            meta,
        });
    } catch (err) {
        console.error('Clearance customer inbox failed:', err.message);
    }
    try {
        await sendToUsers([userId], {
            title,
            body,
            data: { type, ...(meta || {}) },
        });
    } catch (err) {
        console.error('Clearance customer push failed:', err.message);
    }
};

/**
 * Mark clearance required from pre-session meds. Does not verify / unlock.
 */
const markClearanceRequiredFromMeds = async (customerId, meds, sperrfristen, meta = {}) => {
    const needed = clearanceRequiredMedKeys(meds, sperrfristen);
    if (!needed.length) return null;

    const customer = await Customer.findById(customerId);
    if (!customer) return null;

    if (!customer.medical_clearance) {
        customer.medical_clearance = emptyClearance();
    }
    const mc = customer.medical_clearance;

    // Already verified for same reasons — keep verified
    if (mc.status === CLEARANCE_STATUSES.VERIFIED) {
        const existingKeys = new Set((mc.reasons || []).map((r) => r.condition_key));
        const allCovered = needed.every((n) => existingKeys.has(n.condition_key));
        if (allCovered) {
            return serializeClearance(mc);
        }
        // New reason appeared after verification → require again
        mc.status = CLEARANCE_STATUSES.REQUIRED;
        mc.verified_at = null;
        mc.verified_by = null;
        mc.verified_note = '';
    }

    const reasonMap = new Map((mc.reasons || []).map((r) => [r.condition_key, r]));
    for (const n of needed) {
        reasonMap.set(n.condition_key, {
            condition_key: n.condition_key,
            med_key: n.med_key,
            source: meta.source || 'pre_session',
            label: n.condition_key,
        });
    }
    mc.reasons = [...reasonMap.values()];

    if (
        mc.status !== CLEARANCE_STATUSES.PENDING_REVIEW &&
        mc.status !== CLEARANCE_STATUSES.VERIFIED
    ) {
        mc.status = CLEARANCE_STATUSES.REQUIRED;
    }
    if (!mc.required_since) mc.required_since = new Date();

    customer.markModified('medical_clearance');
    await customer.save();

    const name = `${customer.vorname || ''} ${customer.nachname || ''}`.trim() || 'Customer';
    if (mc.status === CLEARANCE_STATUSES.REQUIRED) {
        await notifyCustomerClearance({
            userId: customer.user,
            studioId: customer.aktuelle_firma_id,
            title: 'Medical clearance required',
            body:
                'A doctor\'s certificate is required before laser treatment. ' +
                'Please upload it in your profile. Consultation appointments stay bookable.',
        });
    }

    return serializeClearance(mc);
};

const attachUploadedDocument = async ({
    customerId,
    fileAsset,
    userId,
}) => {
    const customer = await Customer.findById(customerId);
    if (!customer) throw new ApiError(404, 'Customer not found');

    if (!customer.medical_clearance) {
        customer.medical_clearance = emptyClearance();
    }
    const mc = customer.medical_clearance;

    if (
        mc.status === CLEARANCE_STATUSES.NOT_REQUIRED &&
        !(mc.reasons || []).length
    ) {
        // Allow upload when studio/admin already expects clearance, or customer
        // proactively uploads — mark required then pending.
        mc.status = CLEARANCE_STATUSES.REQUIRED;
        mc.required_since = mc.required_since || new Date();
    }

    mc.documents = mc.documents || [];
    mc.documents.push({
        file_id: fileAsset._id,
        uploaded_at: new Date(),
        uploaded_by: userId,
        original_name: fileAsset.original_name || '',
        mime_type: fileAsset.mime_type || '',
    });

    // Upload alone must NOT unlock — move to pending_review only.
    mc.status = CLEARANCE_STATUSES.PENDING_REVIEW;
    mc.rejected_at = null;
    mc.rejected_by = null;
    mc.rejected_reason = '';
    // Clear verified so a re-upload after revoke waits for review again
    mc.verified_at = null;
    mc.verified_by = null;
    mc.verified_note = '';

    customer.markModified('medical_clearance');
    await customer.save();

    const name = `${customer.vorname || ''} ${customer.nachname || ''}`.trim() || 'Customer';
    await notifyStudioClearance({
        studioId: customer.aktuelle_firma_id,
        customerId: customer._id,
        customerName: name,
        title: 'Medical clearance document uploaded',
        body: `${name} uploaded a doctor's certificate. Please verify the document exists for laser treatment — this is not a medical decision.`,
    });

    return serializeClearance(mc);
};

const reviewClearance = async ({
    customerId,
    studioId,
    reviewerUserId,
    decision,
    note = '',
}) => {
    const customer = await Customer.findById(customerId);
    if (!customer) throw new ApiError(404, 'Customer not found');
    if (String(customer.aktuelle_firma_id) !== String(studioId)) {
        throw new ApiError(403, 'Customer is not assigned to this studio');
    }
    if (!customer.medical_clearance) {
        customer.medical_clearance = emptyClearance();
    }
    const mc = customer.medical_clearance;

    if (decision === 'verify') {
        if (!(mc.documents || []).length) {
            throw new ApiError(400, 'Cannot verify without an uploaded document');
        }
        if (mc.status !== CLEARANCE_STATUSES.PENDING_REVIEW && mc.status !== CLEARANCE_STATUSES.REJECTED) {
            // Allow verify from pending or after re-upload path
            if (mc.status !== CLEARANCE_STATUSES.REQUIRED || !(mc.documents || []).length) {
                throw new ApiError(400, 'No document pending review');
            }
        }
        mc.status = CLEARANCE_STATUSES.VERIFIED;
        mc.verified_at = new Date();
        mc.verified_by = reviewerUserId;
        mc.verified_note = String(note || '').trim();
        mc.rejected_at = null;
        mc.rejected_by = null;
        mc.rejected_reason = '';
    } else if (decision === 'reject') {
        mc.status = CLEARANCE_STATUSES.REJECTED;
        mc.rejected_at = new Date();
        mc.rejected_by = reviewerUserId;
        mc.rejected_reason = String(note || '').trim() || 'Document not accepted';
        mc.verified_at = null;
        mc.verified_by = null;
        mc.verified_note = '';
    } else {
        throw new ApiError(400, 'decision must be verify or reject');
    }

    customer.markModified('medical_clearance');
    await customer.save();

    if (decision === 'verify') {
        await notifyCustomerClearance({
            userId: customer.user,
            studioId: customer.aktuelle_firma_id,
            title: 'Medical clearance verified',
            body: 'Your studio confirmed your doctor\'s certificate. Treatment booking is unlocked (other blocking periods may still apply).',
        });
    } else {
        await notifyCustomerClearance({
            userId: customer.user,
            studioId: customer.aktuelle_firma_id,
            title: 'Medical clearance needs a new document',
            body:
                mc.rejected_reason ||
                'Your studio could not verify the uploaded certificate. Please upload a valid doctor\'s confirmation.',
        });
    }

    return serializeClearance(mc);
};

/**
 * ~24h before treatment: ask customer about antibiotics / recovery via inbox,
 * and prepare antibiotic_checks entry. Studio is notified only after a positive answer.
 */
async function runAntibioticPreTreatmentChecks({ limit = 100 } = {}) {
    const Appointment = require('../models/appointmentModel');
    const { APPOINTMENT_STATUS, APPOINTMENT_TYPE } = require('../config/constants');

    const now = new Date();
    const min = new Date(now.getTime() + 20 * 3600 * 1000); // 20h
    const max = new Date(now.getTime() + 28 * 3600 * 1000); // 28h

    const apts = await Appointment.find({
        status: { $in: [APPOINTMENT_STATUS.GEBUCHT, 'gebucht', 'booked'] },
        consultationOnly: { $ne: true },
        type: { $ne: APPOINTMENT_TYPE.BERATUNG },
        date: { $gte: min, $lte: max },
    })
        .select('_id customer studio date case')
        .limit(limit)
        .lean();

    let asked = 0;
    for (const apt of apts) {
        const customer = await Customer.findById(apt.customer);
        if (!customer) continue;
        if (!customer.medical_clearance) {
            customer.medical_clearance = emptyClearance();
        }
        const checks = customer.medical_clearance.antibiotic_checks || [];
        if (checks.some((c) => String(c.appointment_id) === String(apt._id))) {
            continue;
        }

        checks.push({
            appointment_id: apt._id,
            asked_at: now,
            answered_at: null,
            still_on_antibiotics: null,
            not_fully_recovered: null,
            studio_notified: false,
        });
        customer.medical_clearance.antibiotic_checks = checks;
        customer.markModified('medical_clearance');
        await customer.save();

        await notifyCustomerClearance({
            userId: customer.user,
            studioId: customer.aktuelle_firma_id,
            type: 'antibiotic_check',
            meta: { appointment_id: String(apt._id) },
            title: 'Pre-treatment health check',
            body:
                'Your treatment is about tomorrow. Are you still taking antibiotics, or not fully recovered from an illness? Please answer in the app so your studio can prepare.',
        });

        // Case chat stub
        if (apt.case) {
            try {
                const caseDoc = await Case.findById(apt.case);
                if (caseDoc) {
                    caseDoc.chat_nachrichten = caseDoc.chat_nachrichten || [];
                    caseDoc.chat_nachrichten.push({
                        typ: 'system',
                        text:
                            'Pre-treatment check (~24h): Please confirm whether you are still on antibiotics or not fully recovered.',
                        zeitstempel: now,
                    });
                    caseDoc.markModified('chat_nachrichten');
                    await caseDoc.save();
                }
            } catch (err) {
                console.error('Antibiotic check chat stub failed:', err.message);
            }
        }
        asked += 1;
    }
    return { asked, scanned: apts.length };
}

module.exports = {
    CLEARANCE_STATUSES,
    MED_TO_CONDITION_KEY,
    emptyClearance,
    serializeClearance,
    treatmentBlockedByClearance,
    clearanceRequiredMedKeys,
    medUsesClearanceNotDateLock,
    resolveConditionLocks,
    markClearanceRequiredFromMeds,
    attachUploadedDocument,
    reviewClearance,
    notifyStudioClearance,
    notifyCustomerClearance,
    findStudioStaffUserIds,
    runAntibioticPreTreatmentChecks,
};

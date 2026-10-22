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
              document_type: d.document_type || 'medical_clearance',
              case_id: d.case_id ? String(d.case_id) : null,
              studio_id: d.studio_id ? String(d.studio_id) : null,
              medication_category: d.medication_category || '',
              review_status: d.review_status || 'pending',
              reviewed_by: d.reviewed_by ? String(d.reviewed_by) : null,
              reviewed_at: d.reviewed_at || null,
              review_comment: d.review_comment || '',
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

const clearSoftClearanceRequiredFromPreSession = async (customerId) => {
    const customer = await Customer.findById(customerId);
    if (!customer) return null;
    if (!customer.medical_clearance) {
        customer.medical_clearance = emptyClearance();
    }
    const mc = customer.medical_clearance;
    if (mc.status !== CLEARANCE_STATUSES.REQUIRED) {
        return serializeClearance(mc);
    }
    mc.status = CLEARANCE_STATUSES.NOT_REQUIRED;
    mc.reasons = [];
    mc.required_since = null;
    customer.markModified('medical_clearance');
    await customer.save();
    return serializeClearance(mc);
};

const reconcileClearanceFromPreSessionMeds = async (
    customerId,
    meds,
    sperrfristen,
    meta = {}
) => {
    const needed = clearanceRequiredMedKeys(meds, sperrfristen);
    if (needed.length) {
        return markClearanceRequiredFromMeds(customerId, meds, sperrfristen, meta);
    }
    return clearSoftClearanceRequiredFromPreSession(customerId);
};


const markClearanceRequiredFromMeds = async (customerId, meds, sperrfristen, meta = {}) => {
    const needed = clearanceRequiredMedKeys(meds, sperrfristen);
    if (!needed.length) return null;

    const customer = await Customer.findById(customerId);
    if (!customer) return null;

    if (!customer.medical_clearance) {
        customer.medical_clearance = emptyClearance();
    }
    const mc = customer.medical_clearance;

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

const resolveCaseRef = async (caseId, customerId) => {
    if (!caseId) {
        const latest = await Case.findOne({ customer: customerId })
            .sort({ updatedAt: -1 })
            .select('_id caseId studio')
            .lean();
        return latest || null;
    }
    return Case.findOne({ _id: caseId, customer: customerId })
        .select('_id caseId studio')
        .lean();
};

const attachUploadedDocument = async ({
    customerId,
    fileAsset,
    userId,
    caseId = null,
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

    const caseDoc = await resolveCaseRef(caseId, customerId);
    const medCategory =
        (mc.reasons || []).map((r) => r.med_key || r.condition_key).filter(Boolean)[0] ||
        '';

    mc.documents = mc.documents || [];
    mc.documents.push({
        file_id: fileAsset._id,
        uploaded_at: new Date(),
        uploaded_by: userId,
        original_name: fileAsset.original_name || '',
        mime_type: fileAsset.mime_type || '',
        document_type: 'medical_clearance',
        case_id: caseDoc?._id || null,
        studio_id: customer.aktuelle_firma_id || caseDoc?.studio || null,
        medication_category: medCategory,
        review_status: 'pending',
        reviewed_by: null,
        reviewed_at: null,
        review_comment: '',
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

    // Case timeline stub (same central file — linked, not duplicated)
    if (caseDoc?._id) {
        try {
            const liveCase = await Case.findById(caseDoc._id);
            if (liveCase) {
                liveCase.chat_nachrichten = liveCase.chat_nachrichten || [];
                liveCase.chat_nachrichten.push({
                    typ: 'system',
                    text: 'Medical certificate uploaded — waiting for studio review.',
                    zeitstempel: new Date(),
                    meta: {
                        kind: 'medical_clearance_upload',
                        file_id: String(fileAsset._id),
                        clearance_status: CLEARANCE_STATUSES.PENDING_REVIEW,
                    },
                });
                liveCase.markModified('chat_nachrichten');
                await liveCase.save();
            }
        } catch (err) {
            console.error('Clearance case timeline stub failed:', err.message);
        }
    }

    const name = `${customer.vorname || ''} ${customer.nachname || ''}`.trim() || 'Customer';
    const { formatCaseLabel } = require('./formatCaseRef');
    const caseLabel = formatCaseLabel(caseDoc?.caseId);
    await notifyStudioClearance({
        studioId: customer.aktuelle_firma_id,
        customerId: customer._id,
        customerName: name,
        title: `Medical clearance requires review – ${caseLabel}`,
        body:
            `${name} uploaded a medical clearance document for ${caseLabel}. ` +
            'Please confirm that the required clearance has been provided and reviewed — this is not a medical diagnosis.',
    });

    try {
        require('./openActionService').publishOpenActionsChanged(customer.aktuelle_firma_id);
    } catch (_) {
        /* optional */
    }

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

    const now = new Date();
    const comment = String(note || '').trim();

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
        mc.verified_at = now;
        mc.verified_by = reviewerUserId;
        mc.verified_note = comment;
        mc.rejected_at = null;
        mc.rejected_by = null;
        mc.rejected_reason = '';
        for (const doc of mc.documents || []) {
            if (doc.review_status === 'pending' || !doc.review_status) {
                doc.review_status = 'accepted';
                doc.reviewed_by = reviewerUserId;
                doc.reviewed_at = now;
                doc.review_comment = comment;
            }
        }
    } else if (decision === 'reject') {
        mc.status = CLEARANCE_STATUSES.REJECTED;
        mc.rejected_at = now;
        mc.rejected_by = reviewerUserId;
        mc.rejected_reason = comment || 'Document not accepted';
        mc.verified_at = null;
        mc.verified_by = null;
        mc.verified_note = '';
        for (const doc of mc.documents || []) {
            if (doc.review_status === 'pending' || !doc.review_status) {
                doc.review_status = 'rejected';
                doc.reviewed_by = reviewerUserId;
                doc.reviewed_at = now;
                doc.review_comment = mc.rejected_reason;
            }
        }
    } else {
        throw new ApiError(400, 'decision must be verify or reject');
    }

    customer.markModified('medical_clearance');
    await customer.save();

    const linkedCaseId =
        [...(mc.documents || [])].reverse().find((d) => d.case_id)?.case_id || null;

    if (decision === 'verify') {
        let earliestKey = null;
        let body =
            'Your medical clearance has been accepted by the studio. You can now book your next treatment.';
        try {
            if (linkedCaseId) {
                const { computeAvailability } = require('./lockoutEngine');
                const availability = await computeAvailability({
                    activeCaseId: linkedCaseId,
                    customerId: customer._id,
                    consultationOnly: false,
                });
                earliestKey = availability.fruehestes || availability.fruehestes_after_clearance;
                if (
                    earliestKey &&
                    availability.fruehestes &&
                    availability.fruehestes > new Date().toISOString().slice(0, 10)
                ) {
                    body =
                        `Your medical clearance has been accepted by the studio. ` +
                        `Your next treatment is possible from ${earliestKey} at the earliest.`;
                } else if (!availability.fruehestes && availability.treatment_blocked_by_clearance) {
                    body =
                        'Your medical clearance has been accepted by the studio. You can now book your next treatment.';
                } else if (earliestKey) {
                    const today = new Date().toISOString().slice(0, 10);
                    if (earliestKey > today) {
                        body =
                            `Your medical clearance has been accepted by the studio. ` +
                            `Your next treatment is possible from ${earliestKey} at the earliest.`;
                    }
                }
            }
        } catch (err) {
            console.error('Clearance earliest recalculation failed:', err.message);
        }

        await notifyCustomerClearance({
            userId: customer.user,
            studioId: customer.aktuelle_firma_id,
            title: 'Medical clearance accepted',
            body,
            meta: {
                case_id: linkedCaseId ? String(linkedCaseId) : null,
                earliest_treatment: earliestKey,
                screen: 'book',
            },
        });

        // Internal ELAYA chat system message + Book appointment CTA
        try {
            if (customer.aktuelle_firma_id && customer._id) {
                const messagingService = require('../services/messagingService');
                const conversation = await messagingService.getOrCreateConversationForPair(
                    customer._id,
                    customer.aktuelle_firma_id
                );
                await messagingService.postSystemMessage(conversation.id || conversation._id, {
                    text: body,
                    case_id: linkedCaseId || null,
                    meta: {
                        kind: 'medical_clearance_accepted',
                        case_id: linkedCaseId ? String(linkedCaseId) : null,
                        earliest_treatment: earliestKey,
                        cta: 'book_appointment',
                    },
                });
            }
        } catch (err) {
            console.error('Clearance chat system message failed:', err.message);
        }

        if (linkedCaseId) {
            try {
                const liveCase = await Case.findById(linkedCaseId);
                if (liveCase) {
                    liveCase.chat_nachrichten = liveCase.chat_nachrichten || [];
                    liveCase.chat_nachrichten.push({
                        typ: 'system',
                        text: 'Medical clearance accepted by the studio.',
                        zeitstempel: now,
                        meta: {
                            kind: 'medical_clearance_accepted',
                            earliest_treatment: earliestKey,
                        },
                    });
                    liveCase.markModified('chat_nachrichten');
                    await liveCase.save();
                }
            } catch (err) {
                console.error('Clearance case timeline accept stub failed:', err.message);
            }
        }
    } else {
        await notifyCustomerClearance({
            userId: customer.user,
            studioId: customer.aktuelle_firma_id,
            title: 'Medical clearance rejected',
            body:
                mc.rejected_reason ||
                'Medical clearance rejected — please upload a new document.',
        });
        if (linkedCaseId) {
            try {
                const liveCase = await Case.findById(linkedCaseId);
                if (liveCase) {
                    liveCase.chat_nachrichten = liveCase.chat_nachrichten || [];
                    liveCase.chat_nachrichten.push({
                        typ: 'system',
                        text: 'Medical clearance rejected — please upload a new document.',
                        zeitstempel: now,
                    });
                    liveCase.markModified('chat_nachrichten');
                    await liveCase.save();
                }
            } catch (err) {
                console.error('Clearance case timeline reject stub failed:', err.message);
            }
        }
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
    clearSoftClearanceRequiredFromPreSession,
    reconcileClearanceFromPreSessionMeds,
    attachUploadedDocument,
    reviewClearance,
    notifyStudioClearance,
    notifyCustomerClearance,
    findStudioStaffUserIds,
    runAntibioticPreTreatmentChecks,
};

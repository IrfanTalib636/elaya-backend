const crypto = require('crypto');
const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');
const FileAsset = require('../models/fileAssetModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { USER_ROLES } = require('../config/constants');
const { FILE_PURPOSE, FILE_STATUS } = require('../config/storageConfig');
const {
    ensureUploadRoot,
    medicalClearancePath,
    relativePath,
    writeBuffer,
} = require('../services/fileStorageService');
const {
    resolveUploadCustomer,
    assertFileAccess,
    formatFileAsset,
    logFileAccess,
} = require('../services/fileAccessService');
const { FILE_AUDIT_ACTION } = require('../config/storageConfig');
const {
    serializeClearance,
    attachUploadedDocument,
    reviewClearance,
    CLEARANCE_STATUSES,
} = require('../utils/medicalClearanceService');

const isStudio = (role) =>
    role === USER_ROLES.STUDIO_ADMIN || role === USER_ROLES.STUDIO_STAFF;

const getMyClearance = asyncHandler(async (req, res) => {
    if (req.user.role !== USER_ROLES.CUSTOMER || !req.user.customer_id) {
        throw new ApiError(403, 'Customers only');
    }
    const customer = await Customer.findById(req.user.customer_id)
        .select('medical_clearance')
        .lean();
    if (!customer) throw new ApiError(404, 'Customer not found');
    res.json({
        success: true,
        data: { medical_clearance: serializeClearance(customer.medical_clearance) },
    });
});

const getCustomerClearance = asyncHandler(async (req, res) => {
    const customer = await Customer.findById(req.params.id)
        .select('medical_clearance aktuelle_firma_id vorname nachname')
        .lean();
    if (!customer) throw new ApiError(404, 'Customer not found');

    if (isStudio(req.user.role)) {
        if (String(customer.aktuelle_firma_id) !== String(req.user.studio_id)) {
            throw new ApiError(403, 'Not your studio customer');
        }
    } else if (
        req.user.role !== USER_ROLES.ADMIN &&
        req.user.role !== USER_ROLES.SUPER_ADMIN &&
        req.user.role !== USER_ROLES.DEVELOPER
    ) {
        throw new ApiError(403, 'Forbidden');
    }

    res.json({
        success: true,
        data: {
            medical_clearance: serializeClearance(customer.medical_clearance),
            customer_id: String(customer._id),
            customer_name: `${customer.vorname || ''} ${customer.nachname || ''}`.trim(),
        },
    });
});

const uploadClearanceDocument = asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, 'No file provided');

    let customer;
    if (req.user.role === USER_ROLES.CUSTOMER) {
        customer = await Customer.findById(req.user.customer_id);
        if (!customer) throw new ApiError(404, 'Customer not found');
    } else {
        customer = await resolveUploadCustomer(req.user, req.body.customer_id || req.params.id);
    }

    await ensureUploadRoot();
    const fileId = crypto.randomBytes(12).toString('hex');
    const absPath = medicalClearancePath(
        customer.aktuelle_firma_id,
        customer._id,
        fileId,
        req.file.mimetype
    );

    const fileAsset = await FileAsset.create({
        studio: customer.aktuelle_firma_id,
        customer: customer._id,
        purpose: FILE_PURPOSE.MEDICAL_CLEARANCE,
        slot: 'certificate',
        original_name: req.file.originalname || 'certificate',
        mime_type: req.file.mimetype,
        size_bytes: req.file.buffer.length,
        storage_path: relativePath(absPath),
        status: FILE_STATUS.ACTIVE,
        uploaded_by: req.user._id,
    });

    await writeBuffer(absPath, req.file.buffer);
    await logFileAccess(
        fileAsset._id,
        req.user,
        FILE_AUDIT_ACTION.UPLOAD,
        req,
        { purpose: FILE_PURPOSE.MEDICAL_CLEARANCE }
    );

    const clearance = await attachUploadedDocument({
        customerId: customer._id,
        fileAsset,
        userId: req.user._id,
    });

    res.status(201).json({
        success: true,
        data: {
            medical_clearance: clearance,
            file: formatFileAsset(fileAsset),
        },
    });
});

const reviewCustomerClearance = asyncHandler(async (req, res) => {
    if (!isStudio(req.user.role) && req.user.role !== USER_ROLES.SUPER_ADMIN) {
        throw new ApiError(403, 'Studio staff only');
    }
    const studioId = req.user.studio_id;
    if (!studioId && req.user.role !== USER_ROLES.SUPER_ADMIN) {
        throw new ApiError(403, 'Studio required');
    }

    const customer = await Customer.findById(req.params.id).select('aktuelle_firma_id');
    if (!customer) throw new ApiError(404, 'Customer not found');
    const effectiveStudio =
        studioId || customer.aktuelle_firma_id;

    const clearance = await reviewClearance({
        customerId: req.params.id,
        studioId: effectiveStudio,
        reviewerUserId: req.user._id,
        decision: req.body.decision,
        note: req.body.note || '',
    });

    res.json({ success: true, data: { medical_clearance: clearance } });
});

/** Answer antibiotic / recovery check (~24h before treatment). */
const answerAntibioticCheck = asyncHandler(async (req, res) => {
    if (req.user.role !== USER_ROLES.CUSTOMER || !req.user.customer_id) {
        throw new ApiError(403, 'Customers only');
    }
    const { appointment_id, still_on_antibiotics, not_fully_recovered } = req.body;
    if (!appointment_id) throw new ApiError(400, 'appointment_id required');

    const customer = await Customer.findById(req.user.customer_id);
    if (!customer) throw new ApiError(404, 'Customer not found');

    if (!customer.medical_clearance) {
        customer.medical_clearance = { status: CLEARANCE_STATUSES.NOT_REQUIRED, antibiotic_checks: [] };
    }
    const checks = customer.medical_clearance.antibiotic_checks || [];
    let entry = checks.find((c) => String(c.appointment_id) === String(appointment_id));
    if (!entry) {
        entry = {
            appointment_id,
            asked_at: new Date(),
            answered_at: null,
            still_on_antibiotics: null,
            not_fully_recovered: null,
            studio_notified: false,
        };
        checks.push(entry);
        customer.medical_clearance.antibiotic_checks = checks;
    }

    entry.answered_at = new Date();
    entry.still_on_antibiotics = !!still_on_antibiotics;
    entry.not_fully_recovered = !!not_fully_recovered;

    const {
        notifyStudioClearance,
    } = require('../utils/medicalClearanceService');
    const name = `${customer.vorname || ''} ${customer.nachname || ''}`.trim() || 'Customer';

    if ((still_on_antibiotics || not_fully_recovered) && !entry.studio_notified) {
        entry.studio_notified = true;
        const issues = [];
        if (still_on_antibiotics) issues.push('still taking antibiotics');
        if (not_fully_recovered) issues.push('not fully recovered');
        await notifyStudioClearance({
            studioId: customer.aktuelle_firma_id,
            customerId: customer._id,
            customerName: name,
            title: 'Pre-treatment health check — attention needed',
            body: `${name} reported before treatment: ${issues.join(' and ')}. Please contact the customer.`,
            type: 'antibiotic_check',
        });

        // Soft condition: mark illness / review reason without unlocking anything
        const reasons = customer.medical_clearance.reasons || [];
        if (not_fully_recovered && !reasons.some((r) => r.condition_key === 'illness_not_recovered')) {
            reasons.push({
                condition_key: 'illness_not_recovered',
                med_key: 'illness_not_recovered',
                source: 'antibiotic_check',
                label: 'illness_not_recovered',
            });
            customer.medical_clearance.reasons = reasons;
        }
    }

    customer.markModified('medical_clearance');
    await customer.save();

    // Push a case chat stub on related case if any
    try {
        const Appointment = require('../models/appointmentModel');
        const apt = await Appointment.findById(appointment_id).select('case').lean();
        if (apt?.case) {
            const caseDoc = await Case.findById(apt.case);
            if (caseDoc) {
                caseDoc.chat_nachrichten = caseDoc.chat_nachrichten || [];
                caseDoc.chat_nachrichten.push({
                    typ: 'system',
                    text:
                        still_on_antibiotics || not_fully_recovered
                            ? `Pre-treatment check: customer reported ${[
                                  still_on_antibiotics ? 'still on antibiotics' : null,
                                  not_fully_recovered ? 'not fully recovered' : null,
                              ]
                                  .filter(Boolean)
                                  .join(' / ')}.`
                            : 'Pre-treatment check: customer confirmed no antibiotics and full recovery.',
                    zeitstempel: new Date(),
                });
                caseDoc.markModified('chat_nachrichten');
                await caseDoc.save();
            }
        }
    } catch (err) {
        console.error('Antibiotic check case chat failed:', err.message);
    }

    res.json({
        success: true,
        data: {
            medical_clearance: serializeClearance(customer.medical_clearance),
            check: entry,
        },
    });
});

module.exports = {
    getMyClearance,
    getCustomerClearance,
    uploadClearanceDocument,
    reviewCustomerClearance,
    answerAntibioticCheck,
};

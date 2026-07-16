const mongoose = require('mongoose');
const FileAsset = require('../models/fileAssetModel');
const FileAccessAudit = require('../models/fileAccessAuditModel');
const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const ApiError = require('../utils/ApiError');
const { USER_ROLES } = require('../config/constants');
const { FILE_AUDIT_ACTION, FILE_STATUS } = require('../config/storageConfig');
const {
    caseIntakePath,
    sessionProgressPath,
    moveFile,
    absolutePath,
    relativePath,
} = require('./fileStorageService');

const STUDIO_ROLES = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

const isCustomer = (role) => role === USER_ROLES.CUSTOMER;
const isStudio = (role) => STUDIO_ROLES.includes(role);
const isAdmin = (role) => ADMIN_ROLES.includes(role);

const logFileAccess = async (fileId, user, action, req, meta) => {
    await FileAccessAudit.create({
        file: fileId,
        user: user._id,
        action,
        ip: req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || '',
        meta,
    });
};

const resolveUploadCustomer = async (user, customerId) => {
    if (isCustomer(user.role)) {
        const customer = await Customer.findById(user.customer_id);
        if (!customer) throw new ApiError(404, 'Customer profile not found');
        return customer;
    }

    if (!customerId) {
        throw new ApiError(400, 'customer_id is required');
    }

    const customer = await Customer.findById(customerId);
    if (!customer) throw new ApiError(404, 'Customer not found');

    if (isStudio(user.role)) {
        if (customer.aktuelle_firma_id.toString() !== user.studio_id.toString()) {
            throw new ApiError(403, 'Customer is not assigned to your studio');
        }
    }

    return customer;
};

const assertFileAccess = async (user, fileAsset) => {
    if (isAdmin(user.role)) return;

    if (isCustomer(user.role)) {
        if (!fileAsset.customer || fileAsset.customer.toString() !== user.customer_id.toString()) {
            throw new ApiError(403, 'You do not have access to this file');
        }
        return;
    }

    if (isStudio(user.role)) {
        if (fileAsset.studio.toString() !== user.studio_id.toString()) {
            throw new ApiError(403, 'You do not have access to this file');
        }
        return;
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const formatFileAsset = (doc) => ({
    id: doc._id.toString(),
    purpose: doc.purpose,
    slot: doc.slot,
    mime_type: doc.mime_type,
    size_bytes: doc.size_bytes,
    status: doc.status,
    customer_id: doc.customer?.toString() ?? null,
    case_id: doc.case?.toString() ?? null,
    session_id: doc.session?.toString() ?? null,
    created_at: doc.createdAt,
});

const linkIntakeFileToCase = async (fileId, caseDoc, slot, user, req) => {
    if (!fileId || !mongoose.Types.ObjectId.isValid(fileId)) return null;

    const fileAsset = await FileAsset.findById(fileId);
    if (!fileAsset) {
        throw new ApiError(400, `Photo file not found: ${slot}`);
    }

    await assertFileAccess(user, fileAsset);

    if (fileAsset.status === FILE_STATUS.DELETED) {
        throw new ApiError(400, `Photo file is no longer available: ${slot}`);
    }

    if (
        fileAsset.customer &&
        fileAsset.customer.toString() !== caseDoc.customer.toString()
    ) {
        throw new ApiError(400, `Photo file does not belong to this customer: ${slot}`);
    }

    if (fileAsset.studio.toString() !== caseDoc.studio.toString()) {
        throw new ApiError(400, `Photo file does not belong to this studio: ${slot}`);
    }

    const fromPath = absolutePath(fileAsset.storage_path);
    const toPath = caseIntakePath(caseDoc.studio, caseDoc._id, slot, fileAsset.mime_type);
    await moveFile(fromPath, toPath);

    fileAsset.case = caseDoc._id;
    fileAsset.customer = caseDoc.customer;
    fileAsset.slot = slot;
    fileAsset.status = FILE_STATUS.ACTIVE;
    fileAsset.expires_at = undefined;
    fileAsset.storage_path = relativePath(toPath);
    await fileAsset.save();

    await logFileAccess(fileAsset._id, user, FILE_AUDIT_ACTION.LINK, req, { case_id: caseDoc._id.toString() });

    return fileAsset._id.toString();
};

const linkCaseIntakeFiles = async (caseDoc, photoFields, user, req) => {
    const linked = {};

    const slots = [
        ['photo_intake_main', 'main'],
        ['photo_intake_detail', 'detail'],
        ['photo_marker', 'marker'],
    ];

    for (const [field, slot] of slots) {
        const fileId = photoFields[field];
        if (!fileId) continue;
        linked[field] = await linkIntakeFileToCase(fileId, caseDoc, slot, user, req);
    }

    return linked;
};

const linkZonePhotoFiles = async (caseDoc, zones, user, req) => {
    if (!zones?.length) return zones;

    const updated = [];
    for (const zone of zones) {
        const fotoRef = zone.foto_url;
        if (fotoRef && mongoose.Types.ObjectId.isValid(fotoRef)) {
            const fileId = await linkIntakeFileToCase(fotoRef, caseDoc, `zone-${zone.bezeichnung || updated.length}`, user, req);
            updated.push({ ...zone, foto_url: fileId });
        } else {
            updated.push(zone);
        }
    }
    return updated;
};

const attachSessionProgressFile = async (sessionDoc, fileId, user, req) => {
    const fileAsset = await FileAsset.findById(fileId);
    if (!fileAsset) throw new ApiError(400, 'Progress photo file not found');

    await assertFileAccess(user, fileAsset);

    if (fileAsset.studio.toString() !== sessionDoc.studio.toString()) {
        throw new ApiError(403, 'Photo file does not belong to this studio');
    }

    const fromPath = absolutePath(fileAsset.storage_path);
    const toPath = sessionProgressPath(sessionDoc.studio, sessionDoc._id, fileAsset.mime_type);
    await moveFile(fromPath, toPath);

    fileAsset.session = sessionDoc._id;
    fileAsset.case = sessionDoc.case;
    fileAsset.customer = sessionDoc.customer;
    fileAsset.slot = 'progress';
    fileAsset.status = FILE_STATUS.ACTIVE;
    fileAsset.expires_at = undefined;
    fileAsset.storage_path = relativePath(toPath);
    await fileAsset.save();

    await logFileAccess(fileAsset._id, user, FILE_AUDIT_ACTION.LINK, req, {
        session_id: sessionDoc._id.toString(),
    });

    return fileAsset._id.toString();
};

module.exports = {
    logFileAccess,
    resolveUploadCustomer,
    assertFileAccess,
    formatFileAsset,
    linkCaseIntakeFiles,
    linkZonePhotoFiles,
    attachSessionProgressFile,
};

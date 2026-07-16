const FileAsset = require('../models/fileAssetModel');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertCaseAccess, assertSessionAccess } = require('../utils/accessHelpers');
const {
    FILE_STATUS,
    FILE_PURPOSE,
    FILE_AUDIT_ACTION,
    INTAKE_SLOTS,
} = require('../config/storageConfig');
const {
    ensureUploadRoot,
    stagingPath,
    caseIntakePath,
    sessionProgressPath,
    relativePath,
    writeBuffer,
    readFileBuffer,
    stagingExpiry,
} = require('../services/fileStorageService');
const {
    logFileAccess,
    resolveUploadCustomer,
    assertFileAccess,
    formatFileAsset,
} = require('../services/fileAccessService');
const { USER_ROLES } = require('../config/constants');

const uploadRoles = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

const readRoles = uploadRoles;

const saveUploadedFile = async ({
    buffer,
    mimeType,
    originalName,
    studioId,
    customerId,
    userId,
    purpose,
    slot,
    caseId,
    sessionId,
    status,
    expiresAt,
    storageAbsolutePath,
}) => {
    const fileAsset = await FileAsset.create({
        studio: studioId,
        customer: customerId,
        case: caseId,
        session: sessionId,
        purpose,
        slot,
        original_name: originalName,
        mime_type: mimeType,
        size_bytes: buffer.length,
        storage_path: relativePath(storageAbsolutePath),
        status,
        uploaded_by: userId,
        expires_at: expiresAt,
    });

    await writeBuffer(storageAbsolutePath, buffer);
    return fileAsset;
};

const uploadStaging = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ApiError(400, 'No image file provided');
    }

    const slot = (req.body.slot || 'main').trim();
    if (!INTAKE_SLOTS.includes(slot)) {
        throw new ApiError(400, `Invalid slot — must be one of: ${INTAKE_SLOTS.join(', ')}`);
    }

    await ensureUploadRoot();

    const customer = await resolveUploadCustomer(req.user, req.body.customer_id);
    const studioId = customer.aktuelle_firma_id;

    const fileAsset = await FileAsset.create({
        studio: studioId,
        customer: customer._id,
        purpose: FILE_PURPOSE.CASE_INTAKE,
        slot,
        original_name: req.file.originalname || '',
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        storage_path: 'pending',
        status: FILE_STATUS.STAGING,
        uploaded_by: req.user._id,
        expires_at: stagingExpiry(),
    });

    const absPath = stagingPath(studioId, fileAsset._id, req.file.mimetype);
    await writeBuffer(absPath, req.file.buffer);

    fileAsset.storage_path = relativePath(absPath);
    await fileAsset.save();

    await logFileAccess(fileAsset._id, req.user, FILE_AUDIT_ACTION.UPLOAD, req, { slot, staging: true });

    res.status(201).json({
        success: true,
        message: 'Photo uploaded',
        data: formatFileAsset(fileAsset),
    });
});

const uploadCaseIntake = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ApiError(400, 'No image file provided');
    }

    const slot = (req.body.slot || 'main').trim();
    if (!INTAKE_SLOTS.includes(slot)) {
        throw new ApiError(400, `Invalid slot — must be one of: ${INTAKE_SLOTS.join(', ')}`);
    }

    const caseDoc = await Case.findById(req.params.caseId);
    if (!caseDoc) throw new ApiError(404, 'Case not found');

    await assertCaseAccess(req.user, caseDoc);
    await ensureUploadRoot();

    const absPath = caseIntakePath(caseDoc.studio, caseDoc._id, slot, req.file.mimetype);

    const fileAsset = await saveUploadedFile({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname || '',
        studioId: caseDoc.studio,
        customerId: caseDoc.customer,
        userId: req.user._id,
        purpose: FILE_PURPOSE.CASE_INTAKE,
        slot,
        caseId: caseDoc._id,
        status: FILE_STATUS.ACTIVE,
        storageAbsolutePath: absPath,
    });

    await logFileAccess(fileAsset._id, req.user, FILE_AUDIT_ACTION.UPLOAD, req, {
        case_id: caseDoc._id.toString(),
        slot,
    });

    res.status(201).json({
        success: true,
        message: 'Case photo uploaded',
        data: formatFileAsset(fileAsset),
    });
});

const uploadSessionProgress = asyncHandler(async (req, res) => {
    if (!req.file) {
        throw new ApiError(400, 'No image file provided');
    }

    const sessionDoc = await Session.findById(req.params.sessionId);
    if (!sessionDoc) throw new ApiError(404, 'Session not found');

    await assertSessionAccess(req.user, sessionDoc);
    await ensureUploadRoot();

    const absPath = sessionProgressPath(sessionDoc.studio, sessionDoc._id, req.file.mimetype);

    const fileAsset = await saveUploadedFile({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname || '',
        studioId: sessionDoc.studio,
        customerId: sessionDoc.customer,
        userId: req.user._id,
        purpose: FILE_PURPOSE.SESSION_PROGRESS,
        slot: 'progress',
        caseId: sessionDoc.case,
        sessionId: sessionDoc._id,
        status: FILE_STATUS.ACTIVE,
        storageAbsolutePath: absPath,
    });

    await logFileAccess(fileAsset._id, req.user, FILE_AUDIT_ACTION.UPLOAD, req, {
        session_id: sessionDoc._id.toString(),
    });

    res.status(201).json({
        success: true,
        message: 'Session progress photo uploaded',
        data: {
            ...formatFileAsset(fileAsset),
            file_id: fileAsset._id.toString(),
        },
    });
});

const getFileMeta = asyncHandler(async (req, res) => {
    const fileAsset = await FileAsset.findById(req.params.fileId);
    if (!fileAsset || fileAsset.status === FILE_STATUS.DELETED) {
        throw new ApiError(404, 'File not found');
    }

    await assertFileAccess(req.user, fileAsset);
    await logFileAccess(fileAsset._id, req.user, FILE_AUDIT_ACTION.VIEW, req);

    res.status(200).json({
        success: true,
        data: formatFileAsset(fileAsset),
    });
});

const getFileContent = asyncHandler(async (req, res) => {
    const fileAsset = await FileAsset.findById(req.params.fileId);
    if (!fileAsset || fileAsset.status === FILE_STATUS.DELETED) {
        throw new ApiError(404, 'File not found');
    }

    await assertFileAccess(req.user, fileAsset);
    await logFileAccess(fileAsset._id, req.user, FILE_AUDIT_ACTION.DOWNLOAD, req);

    const buffer = await readFileBuffer(fileAsset.storage_path);

    res.set('Content-Type', fileAsset.mime_type);
    res.set('Content-Length', buffer.length);
    res.set('Cache-Control', 'private, no-store');
    res.send(buffer);
});

const deleteStagingFile = asyncHandler(async (req, res) => {
    const fileAsset = await FileAsset.findById(req.params.fileId);
    if (!fileAsset) throw new ApiError(404, 'File not found');

    await assertFileAccess(req.user, fileAsset);

    if (fileAsset.status !== FILE_STATUS.STAGING) {
        throw new ApiError(400, 'Only staging uploads can be deleted this way');
    }

    const { removeFile } = require('../services/fileStorageService');
    await removeFile(fileAsset.storage_path);

    fileAsset.status = FILE_STATUS.DELETED;
    await fileAsset.save();

    await logFileAccess(fileAsset._id, req.user, FILE_AUDIT_ACTION.DELETE, req);

    res.status(200).json({
        success: true,
        message: 'Staging photo removed',
    });
});

module.exports = {
    uploadRoles,
    readRoles,
    uploadStaging,
    uploadCaseIntake,
    uploadSessionProgress,
    getFileMeta,
    getFileContent,
    deleteStagingFile,
};

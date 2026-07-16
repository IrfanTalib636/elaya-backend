const fs = require('fs/promises');
const path = require('path');
const ApiError = require('./ApiError');
const { UPLOAD_ROOT } = require('../config/storageConfig');

const SIGNATURE_FILENAME = 'signature.jpg';

const isSignatureStoragePath = (value) =>
    typeof value === 'string' &&
    value.length > 0 &&
    !value.startsWith('data:') &&
    value.endsWith(SIGNATURE_FILENAME);

const parseSignatureImage = (dataUri) => {
    if (typeof dataUri !== 'string' || !dataUri.length) {
        throw new ApiError(400, 'unterschrift_data is required');
    }

    if (isSignatureStoragePath(dataUri)) {
        throw new ApiError(400, 'unterschrift_data must be image data, not a storage path');
    }

    const match = dataUri.match(/^data:image\/([\w+.-]+);base64,(.+)$/i);
    if (!match) {
        throw new ApiError(400, 'unterschrift_data must be a base64 image data URI');
    }

    const mime = `image/${match[1].toLowerCase()}`;
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mime)) {
        throw new ApiError(400, 'Signature image must be JPEG, PNG, or WebP');
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) {
        throw new ApiError(400, 'Signature image is empty');
    }

    return { mime, buffer };
};

const signatureRelativePath = (studioId, caseId) =>
    path.posix.join(studioId.toString(), 'cases', caseId.toString(), SIGNATURE_FILENAME);

const saveSignatureImage = async (studioId, caseId, buffer) => {
    const relative = signatureRelativePath(studioId, caseId);
    const absolute = path.join(UPLOAD_ROOT, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);
    return relative;
};

/** Move legacy base64 signatures from MongoDB to disk on first access. */
const migrateSignatureToDisk = async (caseDoc) => {
    const stored = caseDoc.unterschrift?.unterschrift_data;
    if (!stored || !stored.startsWith('data:image/')) {
        return stored;
    }

    const { buffer } = parseSignatureImage(stored);
    const storagePath = await saveSignatureImage(caseDoc.studio, caseDoc._id, buffer);
    caseDoc.unterschrift.unterschrift_data = storagePath;
    caseDoc.markModified('unterschrift');
    await caseDoc.save();
    return storagePath;
};

const readSignatureImage = async (relativePath) => {
    const absolute = path.join(UPLOAD_ROOT, relativePath);
    return fs.readFile(absolute);
};

module.exports = {
    SIGNATURE_FILENAME,
    isSignatureStoragePath,
    parseSignatureImage,
    signatureRelativePath,
    saveSignatureImage,
    migrateSignatureToDisk,
    readSignatureImage,
};

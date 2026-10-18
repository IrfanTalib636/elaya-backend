const sharp = require('sharp');
const ApiError = require('../utils/ApiError');
const { MAX_FILE_BYTES } = require('../config/storageConfig');

const STEPS = [
    { edge: 2560, quality: 82 },
    { edge: 2000, quality: 72 },
    { edge: 1600, quality: 60 },
    { edge: 1280, quality: 48 },
    { edge: 960, quality: 38 },
];

const tooLargeMessage = () =>
    `Maximum image size should be ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB.`;

const encodeJpeg = (buffer, edge, quality) => {
    const pipeline = sharp(buffer, { failOn: 'none', limitInputPixels: false, pages: 1 })
        .rotate()
        .resize({
            width: edge,
            height: edge,
            fit: 'inside',
            withoutEnlargement: true,
        });
    return pipeline.jpeg({ quality }).toBuffer();
};

/**
 * Store a JPEG that stays within the upload cap. Callers already reject
 * anything over that cap; this still shrinks typical phone photos so a
 * 5 MB upload is not what lands on disk.
 */
const normalizeUploadedImage = async (buffer, mimeType) => {
    if (mimeType === 'application/pdf') {
        return { buffer, mimeType };
    }

    try {
        const meta = await sharp(buffer, { failOn: 'none', limitInputPixels: false, pages: 1 }).metadata();
        if (!meta.width || !meta.height || !meta.format) {
            if (buffer.length <= MAX_FILE_BYTES) return { buffer, mimeType };
            throw new ApiError(400, tooLargeMessage());
        }

        for (const step of STEPS) {
            const out = await encodeJpeg(buffer, step.edge, step.quality);
            if (out.length <= MAX_FILE_BYTES) {
                return { buffer: out, mimeType: 'image/jpeg' };
            }
        }
        throw new ApiError(400, tooLargeMessage());
    } catch (err) {
        if (err instanceof ApiError) throw err;
        if (buffer.length <= MAX_FILE_BYTES) return { buffer, mimeType };
        throw new ApiError(400, tooLargeMessage());
    }
};

module.exports = { normalizeUploadedImage };

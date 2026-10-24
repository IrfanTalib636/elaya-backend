const sharp = require('sharp');
const ApiError = require('../utils/ApiError');
const { MAX_FILE_BYTES } = require('../config/storageConfig');

const STEPS = [
    { edge: 2560, quality: 82 },
    { edge: 2000, quality: 72 },
    { edge: 1600, quality: 60 },
    { edge: 1280, quality: 48 },
    { edge: 960, quality: 38 },
    { edge: 720, quality: 32 },
    { edge: 512, quality: 28 },
    { edge: 400, quality: 24 },
    { edge: 320, quality: 20 },
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
 * Store a JPEG that stays within the upload cap. Multer already rejects bodies
 * over MAX_FILE_BYTES; this still shrinks typical phone photos for disk/AI.
 * For decodable images we keep shrinking until under the cap instead of failing.
 */
const normalizeUploadedImage = async (buffer, mimeType) => {
    if (mimeType === 'application/pdf') {
        if (buffer.length > MAX_FILE_BYTES) {
            throw new ApiError(400, tooLargeMessage());
        }
        return { buffer, mimeType };
    }

    try {
        const meta = await sharp(buffer, {
            failOn: 'none',
            limitInputPixels: false,
            pages: 1,
        }).metadata();
        if (!meta.width || !meta.height || !meta.format) {
            if (buffer.length <= MAX_FILE_BYTES) return { buffer, mimeType };
            throw new ApiError(400, tooLargeMessage());
        }

        let smallest = null;
        for (const step of STEPS) {
            const out = await encodeJpeg(buffer, step.edge, step.quality);
            if (!smallest || out.length < smallest.length) smallest = out;
            if (out.length <= MAX_FILE_BYTES) {
                return { buffer: out, mimeType: 'image/jpeg' };
            }
        }
        if (smallest && smallest.length <= MAX_FILE_BYTES) {
            return { buffer: smallest, mimeType: 'image/jpeg' };
        }
        // Extreme fallback — should fit for any real photo.
        const tiny = await encodeJpeg(buffer, 240, 18);
        if (tiny.length <= MAX_FILE_BYTES) {
            return { buffer: tiny, mimeType: 'image/jpeg' };
        }
        throw new ApiError(400, tooLargeMessage());
    } catch (err) {
        if (err instanceof ApiError) throw err;
        if (buffer.length <= MAX_FILE_BYTES) return { buffer, mimeType };
        throw new ApiError(400, tooLargeMessage());
    }
};

module.exports = { normalizeUploadedImage };

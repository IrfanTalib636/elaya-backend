const multer = require('multer');
const ApiError = require('../utils/ApiError');
const {
    MAX_FILE_BYTES,
    ALLOWED_MIME_TYPES,
} = require('../config/storageConfig');

const memoryStorage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
        return;
    }
    cb(new ApiError(400, 'Only JPEG, PNG, WebP, or PDF files are allowed'));
};

/** Image-only filter (no PDF) — used for shop product photos. */
const imageOnlyFileFilter = (_req, file, cb) => {
    const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (IMAGE_TYPES.has(file.mimetype)) {
        cb(null, true);
        return;
    }
    cb(new ApiError(400, 'Only JPEG, PNG, or WebP images are allowed'));
};

const uploadSingle = multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    fileFilter,
}).single('file');

const MAX_SHOP_IMAGES = 8;

const uploadShopImages = multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_SHOP_IMAGES },
    fileFilter: imageOnlyFileFilter,
}).array('files', MAX_SHOP_IMAGES);

const handleUpload = (req, res, next) => {
    uploadSingle(req, res, (err) => {
        if (!err) return next();

        if (err instanceof ApiError) return next(err);

        if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new ApiError(400, `Image must be smaller than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB`));
        }

        return next(err);
    });
};

/** Multipart handler for multiple shop product images (field name "files"). */
const handleShopImagesUpload = (req, res, next) => {
    uploadShopImages(req, res, (err) => {
        if (!err) return next();

        if (err instanceof ApiError) return next(err);

        if (err.code === 'LIMIT_FILE_SIZE') {
            return next(new ApiError(400, `Each image must be smaller than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB`));
        }
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
            return next(new ApiError(400, `You can upload up to ${MAX_SHOP_IMAGES} images at once`));
        }

        return next(err);
    });
};

module.exports = { handleUpload, handleShopImagesUpload };

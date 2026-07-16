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
    cb(new ApiError(400, 'Only JPEG, PNG, and WebP images are allowed'));
};

const uploadSingle = multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_FILE_BYTES, files: 1 },
    fileFilter,
}).single('file');

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

module.exports = { handleUpload };

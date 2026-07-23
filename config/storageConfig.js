const path = require('path');

const UPLOAD_ROOT = process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads');

const MAX_FILE_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 5 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
]);

const MIME_EXTENSIONS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
};

const STAGING_TTL_HOURS = Number(process.env.UPLOAD_STAGING_TTL_HOURS) || 24;

const INTAKE_SLOTS = ['main', 'detail', 'marker', 'zone', 'nachsorge'];

const FILE_STATUS = {
    STAGING: 'staging',
    ACTIVE: 'active',
    DELETED: 'deleted',
};

const FILE_PURPOSE = {
    CASE_INTAKE: 'case_intake',
    ZONE_PHOTO: 'zone_photo',
    SESSION_PROGRESS: 'session_progress',
    NACHSORGE: 'nachsorge',
};

const FILE_AUDIT_ACTION = {
    UPLOAD: 'upload',
    VIEW: 'view',
    DOWNLOAD: 'download',
    DELETE: 'delete',
    LINK: 'link',
    AI_ANALYZE: 'ai_analyze',
};

module.exports = {
    UPLOAD_ROOT,
    MAX_FILE_BYTES,
    ALLOWED_MIME_TYPES,
    MIME_EXTENSIONS,
    STAGING_TTL_HOURS,
    INTAKE_SLOTS,
    FILE_STATUS,
    FILE_PURPOSE,
    FILE_AUDIT_ACTION,
};

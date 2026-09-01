const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
    UPLOAD_ROOT,
    MIME_EXTENSIONS,
    STAGING_TTL_HOURS,
    FILE_STATUS,
} = require('../config/storageConfig');

const ensureDir = async (dirPath) => {
    await fs.mkdir(dirPath, { recursive: true });
};

const ensureUploadRoot = async () => {
    await ensureDir(UPLOAD_ROOT);
};

const studioDir = (studioId) => path.join(UPLOAD_ROOT, studioId.toString());

const stagingPath = (studioId, fileId, mimeType) => {
    const ext = MIME_EXTENSIONS[mimeType] || '.bin';
    return path.join(studioDir(studioId), 'staging', `${fileId}${ext}`);
};

const caseIntakePath = (studioId, caseId, slot, mimeType) => {
    const ext = MIME_EXTENSIONS[mimeType] || '.bin';
    return path.join(studioDir(studioId), 'cases', caseId.toString(), `${slot}${ext}`);
};

const sessionProgressPath = (studioId, sessionId, mimeType) => {
    const ext = MIME_EXTENSIONS[mimeType] || '.bin';
    return path.join(studioDir(studioId), 'sessions', sessionId.toString(), `progress${ext}`);
};

const relativePath = (absolutePath) => path.relative(UPLOAD_ROOT, absolutePath);

const absolutePath = (relativeStoragePath) => path.join(UPLOAD_ROOT, relativeStoragePath);

const writeBuffer = async (absoluteFilePath, buffer) => {
    await ensureDir(path.dirname(absoluteFilePath));
    await fs.writeFile(absoluteFilePath, buffer);
};

const moveFile = async (fromAbsolute, toAbsolute) => {
    await ensureDir(path.dirname(toAbsolute));
    try {
        await fs.rename(fromAbsolute, toAbsolute);
    } catch (err) {
        if (err.code === 'EXDEV') {
            await fs.copyFile(fromAbsolute, toAbsolute);
            await fs.unlink(fromAbsolute);
            return;
        }
        throw err;
    }
};

const removeFile = async (relativeStoragePath) => {
    if (!relativeStoragePath) return;
    try {
        await fs.unlink(absolutePath(relativeStoragePath));
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }
};

/**
 * Recursively removes a directory below UPLOAD_ROOT. Used by permanent account
 * deletion to drop the now-empty per-case and per-session folders. Paths that
 * would escape UPLOAD_ROOT are refused so a malformed id can never delete
 * anything outside the upload tree.
 */
const removeDirectory = async (relativeDirPath) => {
    if (!relativeDirPath) return;
    const absolute = absolutePath(relativeDirPath);
    const root = path.resolve(UPLOAD_ROOT);
    const target = path.resolve(absolute);
    if (target === root || !target.startsWith(root + path.sep)) return;
    await fs.rm(target, { recursive: true, force: true });
};

const readFileBuffer = async (relativeStoragePath) =>
    fs.readFile(absolutePath(relativeStoragePath));

const stagingExpiry = () => {
    const d = new Date();
    d.setHours(d.getHours() + STAGING_TTL_HOURS);
    return d;
};

const hashBuffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

module.exports = {
    ensureUploadRoot,
    stagingPath,
    caseIntakePath,
    sessionProgressPath,
    relativePath,
    absolutePath,
    writeBuffer,
    moveFile,
    removeFile,
    removeDirectory,
    readFileBuffer,
    stagingExpiry,
    hashBuffer,
};

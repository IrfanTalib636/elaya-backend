/**
 * Storage for ElayShop product images.
 *
 * Unlike the medical/case photo pipeline (fileAssetModel + strict per-studio
 * ACL), product photos are catalog imagery — non-sensitive and meant to be
 * visible to every customer. So they are written to disk under
 * `UPLOAD_ROOT/shop-products/` and served back via a public static route
 * (`/shop-images/:filename`, mounted in server.js) instead of going through
 * the authenticated /files/:id/content pipeline.
 */
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_ROOT, MIME_EXTENSIONS } = require('../config/storageConfig');
const { ensureUploadRoot, writeBuffer, removeFile } = require('./fileStorageService');

const SHOP_PRODUCT_DIR = 'shop-products';
const PUBLIC_PREFIX = '/shop-images/';

const shopProductImageAbsPath = (filename) =>
    path.join(UPLOAD_ROOT, SHOP_PRODUCT_DIR, filename);

/** Saves one uploaded image buffer, returns its public URL. */
const saveShopProductImage = async (buffer, mimeType) => {
    await ensureUploadRoot();
    const ext = MIME_EXTENSIONS[mimeType] || '.jpg';
    const filename = `${crypto.randomUUID()}${ext}`;
    await writeBuffer(shopProductImageAbsPath(filename), buffer);
    return `${PUBLIC_PREFIX}${filename}`;
};

/** Saves multiple uploaded image buffers, returns their public URLs (in order). */
const saveShopProductImages = async (files = []) => {
    const urls = [];
    for (const file of files) {
        urls.push(await saveShopProductImage(file.buffer, file.mimetype));
    }
    return urls;
};

/** Best-effort delete of a previously uploaded product image by its public URL. No-op for external URLs. */
const deleteShopProductImageByUrl = async (url) => {
    if (!url || !url.startsWith(PUBLIC_PREFIX)) return;
    const filename = url.slice(PUBLIC_PREFIX.length);
    if (!filename || filename.includes('/') || filename.includes('..')) return;
    await removeFile(path.join(SHOP_PRODUCT_DIR, filename));
};

module.exports = {
    SHOP_PRODUCT_DIR,
    PUBLIC_PREFIX,
    saveShopProductImage,
    saveShopProductImages,
    deleteShopProductImageByUrl,
};

const LaserDevice = require('../models/laserDeviceModel');
const { LASER_CATALOG_DEFAULTS } = require('../config/laserCatalogDefaults');
const ApiError = require('./ApiError');

const formatLaserDevice = (doc) => {
    const d = doc?.toObject ? doc.toObject() : doc;
    if (!d) return null;
    return {
        id: String(d._id),
        manufacturer: d.manufacturer,
        model: d.model,
        wavelengths_nm: Array.isArray(d.wavelengths_nm) ? d.wavelengths_nm : [],
        notes: d.notes || '',
        active: Boolean(d.active),
        label: `${d.manufacturer} ${d.model}`.trim(),
        created_at: d.createdAt || null,
        updated_at: d.updatedAt || null,
    };
};

const ensureLaserCatalogSeeded = async () => {
    const count = await LaserDevice.countDocuments();
    if (count > 0) return count;
    await LaserDevice.insertMany(
        LASER_CATALOG_DEFAULTS.map((row) => ({
            ...row,
            wavelengths_nm: [...(row.wavelengths_nm || [])],
        }))
    );
    return LASER_CATALOG_DEFAULTS.length;
};

const listLaserDevices = async ({ activeOnly = false } = {}) => {
    await ensureLaserCatalogSeeded();
    const filter = activeOnly ? { active: true } : {};
    const rows = await LaserDevice.find(filter).sort({ manufacturer: 1, model: 1 });
    return rows.map(formatLaserDevice);
};

const getLaserDeviceById = async (id, { requireActive = false } = {}) => {
    const doc = await LaserDevice.findById(id);
    if (!doc) throw new ApiError(404, 'Laser device not found');
    if (requireActive && !doc.active) {
        throw new ApiError(400, 'Laser device is inactive');
    }
    return formatLaserDevice(doc);
};

const assertActiveLaserDeviceId = async (id) => {
    if (!id) return null;
    const formatted = await getLaserDeviceById(id, { requireActive: true });
    return formatted;
};

const createLaserDevice = async (payload, userId = null) => {
    try {
        const doc = await LaserDevice.create({
            manufacturer: String(payload.manufacturer || '').trim(),
            model: String(payload.model || '').trim(),
            wavelengths_nm: payload.wavelengths_nm || [],
            notes: payload.notes || '',
            active: payload.active !== false,
            created_by: userId,
            updated_by: userId,
        });
        return formatLaserDevice(doc);
    } catch (err) {
        if (err?.code === 11000) {
            throw new ApiError(409, 'A laser with this manufacturer and model already exists');
        }
        throw err;
    }
};

const updateLaserDevice = async (id, payload, userId = null) => {
    const doc = await LaserDevice.findById(id);
    if (!doc) throw new ApiError(404, 'Laser device not found');

    if (payload.manufacturer !== undefined) doc.manufacturer = String(payload.manufacturer).trim();
    if (payload.model !== undefined) doc.model = String(payload.model).trim();
    if (payload.wavelengths_nm !== undefined) doc.wavelengths_nm = payload.wavelengths_nm;
    if (payload.notes !== undefined) doc.notes = payload.notes;
    if (payload.active !== undefined) doc.active = Boolean(payload.active);
    doc.updated_by = userId;

    try {
        await doc.save();
    } catch (err) {
        if (err?.code === 11000) {
            throw new ApiError(409, 'A laser with this manufacturer and model already exists');
        }
        throw err;
    }
    return formatLaserDevice(doc);
};

module.exports = {
    formatLaserDevice,
    ensureLaserCatalogSeeded,
    listLaserDevices,
    getLaserDeviceById,
    assertActiveLaserDeviceId,
    createLaserDevice,
    updateLaserDevice,
};

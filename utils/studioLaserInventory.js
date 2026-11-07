const mongoose = require('mongoose');
const Studio = require('../models/studioModel');
const ApiError = require('./ApiError');
const {
    getLaserDeviceById,
    formatLaserDevice,
    assertActiveLaserDeviceId,
    ensureLaserCatalogSeeded,
} = require('./laserCatalogService');
const LaserDevice = require('../models/laserDeviceModel');

const inventoryIds = (studio) =>
    (studio.laser_inventory || [])
        .map((row) => (row.laser_device_id ? String(row.laser_device_id) : null))
        .filter(Boolean);

const studioHasLaser = (studio, deviceId) => {
    if (!deviceId) return false;
    return inventoryIds(studio).includes(String(deviceId));
};


const roomLaserIds = (room) => {
    if (!room) return [];
    const ids = [];
    if (Array.isArray(room.laser_device_ids)) {
        for (const raw of room.laser_device_ids) {
            const id = raw ? String(raw) : null;
            if (id && !ids.includes(id)) ids.push(id);
        }
    }
    const legacy = room.laser_device_id ? String(room.laser_device_id) : null;
    if (legacy && !ids.includes(legacy)) ids.push(legacy);
    return ids;
};

const syncInventoryFromRooms = async (studio, userId = null) => {
    const rooms = studio.behandlungsraeume || [];
    const have = new Set(inventoryIds(studio));
    let changed = false;
    for (const room of rooms) {
        for (const id of roomLaserIds(room)) {
            if (!id || have.has(id)) continue;
            if (!mongoose.Types.ObjectId.isValid(id)) continue;
            studio.laser_inventory = studio.laser_inventory || [];
            studio.laser_inventory.push({
                laser_device_id: id,
                assigned_at: new Date(),
                assigned_by: userId || null,
                source_request_id: null,
            });
            have.add(id);
            changed = true;
        }
    }
    if (changed) {
        studio.markModified('laser_inventory');
        await studio.save();
    }
    return studio;
};

const assignLaserToStudio = async ({
    studioId,
    laserDeviceId,
    userId = null,
    sourceRequestId = null,
}) => {
    if (!mongoose.Types.ObjectId.isValid(studioId)) {
        throw new ApiError(400, 'Invalid studio id');
    }
    await ensureLaserCatalogSeeded();
    const device = await assertActiveLaserDeviceId(laserDeviceId);
    const studio = await Studio.findById(studioId);
    if (!studio) throw new ApiError(404, 'Studio not found');

    if (studioHasLaser(studio, device.id)) {
        return { studio, device, already: true };
    }

    studio.laser_inventory = studio.laser_inventory || [];
    studio.laser_inventory.push({
        laser_device_id: device.id,
        assigned_at: new Date(),
        assigned_by: userId || null,
        source_request_id: sourceRequestId || null,
    });
    studio.markModified('laser_inventory');
    await studio.save();
    return { studio, device, already: false };
};

const unassignLaserFromStudio = async ({ studioId, laserDeviceId }) => {
    const id = String(laserDeviceId || '');
    if (!mongoose.Types.ObjectId.isValid(studioId)) {
        throw new ApiError(400, 'Invalid studio id');
    }
    if (!mongoose.Types.ObjectId.isValid(id)) {
        throw new ApiError(400, 'Invalid laser device id');
    }
    const studio = await Studio.findById(studioId);
    if (!studio) throw new ApiError(404, 'Studio not found');

    const before = (studio.laser_inventory || []).length;
    studio.laser_inventory = (studio.laser_inventory || []).filter(
        (row) => String(row.laser_device_id) !== id
    );
    const removed = studio.laser_inventory.length !== before;

    let roomsChanged = false;
    for (const room of studio.behandlungsraeume || []) {
        const ids = roomLaserIds(room).filter((x) => x !== id);
        const prevIds = roomLaserIds(room);
        if (ids.length !== prevIds.length) {
            room.laser_device_ids = ids;
            room.laser_device_id = ids[0] || null;
            if (!ids.length) {
                room.laser_brand = '';
                room.laser_model = '';
            }
            roomsChanged = true;
        }
    }

    if (removed) studio.markModified('laser_inventory');
    if (roomsChanged) studio.markModified('behandlungsraeume');
    if (removed || roomsChanged) await studio.save();

    return { studio, removed };
};

const listStudioInventoryDevices = async (studio) => {
    await ensureLaserCatalogSeeded();
    await syncInventoryFromRooms(studio);
    const refreshed = await Studio.findById(studio._id);
    const ids = inventoryIds(refreshed);
    if (!ids.length) return [];

    const docs = await LaserDevice.find({
        _id: { $in: ids },
        active: true,
    }).sort({ manufacturer: 1, model: 1 });

    return docs.map((doc) => formatLaserDevice(doc, null));
};

const findLaserByManufacturerModel = async (manufacturer, model) => {
    const mfr = String(manufacturer || '').trim();
    const mdl = String(model || '').trim();
    if (!mfr || !mdl) return null;
    await ensureLaserCatalogSeeded();
    const doc = await LaserDevice.findOne({ manufacturer: mfr, model: mdl }).collation({
        locale: 'en',
        strength: 2,
    });
    return doc ? formatLaserDevice(doc, null) : null;
};

module.exports = {
    inventoryIds,
    studioHasLaser,
    roomLaserIds,
    syncInventoryFromRooms,
    assignLaserToStudio,
    unassignLaserFromStudio,
    listStudioInventoryDevices,
    findLaserByManufacturerModel,
    getLaserDeviceById,
};

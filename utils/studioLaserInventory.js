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

/**
 * Soft-migrate: room-linked catalog lasers that are not yet in inventory get
 * added so existing studios keep working after inventory lockdown.
 */
const syncInventoryFromRooms = async (studio, userId = null) => {
    const rooms = studio.behandlungsraeume || [];
    const have = new Set(inventoryIds(studio));
    let changed = false;
    for (const room of rooms) {
        const id = room.laser_device_id ? String(room.laser_device_id) : null;
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
    if (changed) {
        studio.markModified('laser_inventory');
        await studio.save();
    }
    return studio;
};

/**
 * Idempotently assign a catalog laser to a studio's inventory.
 */
const assignLaserToStudio = async ({
    studioId,
    laserDeviceId,
    userId = null,
    sourceRequestId = null,
}) => {
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
    syncInventoryFromRooms,
    assignLaserToStudio,
    listStudioInventoryDevices,
    findLaserByManufacturerModel,
    getLaserDeviceById,
};

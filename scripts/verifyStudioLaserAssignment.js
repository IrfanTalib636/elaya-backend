
require('dotenv').config();
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const Studio = require('../models/studioModel');
const LaserDevice = require('../models/laserDeviceModel');
const ApiError = require('../utils/ApiError');
const {
    roomLaserIds,
    studioHasLaser,
    assignLaserToStudio,
    unassignLaserFromStudio,
    listStudioInventoryDevices,
} = require('../utils/studioLaserInventory');
const { ensureLaserCatalogSeeded } = require('../utils/laserCatalogService');

let passed = 0;
let failed = 0;

const check = (ok, label, detail = '') => {
    if (ok) {
        passed += 1;
        console.log(`PASS  ${label}`);
    } else {
        failed += 1;
        console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
};

const runUnit = () => {
    console.log('\n=== Unit: roomLaserIds ===');

    check(
        JSON.stringify(roomLaserIds(null)) === '[]',
        'null room → empty ids'
    );
    check(
        JSON.stringify(roomLaserIds({})) === '[]',
        'empty room → empty ids'
    );
    check(
        JSON.stringify(roomLaserIds({ laser_device_id: 'abc' })) === '["abc"]',
        'legacy laser_device_id alone'
    );
    check(
        JSON.stringify(
            roomLaserIds({
                laser_device_ids: ['a', 'b'],
                laser_device_id: 'a',
            })
        ) === '["a","b"]',
        'multi ids + legacy primary de-duped'
    );
    check(
        JSON.stringify(
            roomLaserIds({
                laser_device_ids: ['x'],
                laser_device_id: 'y',
            })
        ) === '["x","y"]',
        'legacy id appended when not already in array'
    );
    check(
        JSON.stringify(
            roomLaserIds({
                laser_device_ids: ['a', 'a', null, ''],
                laser_device_id: 'a',
            })
        ) === '["a"]',
        'filters empty/duplicate entries'
    );
};

const runIntegration = async () => {
    console.log('\n=== Integration: assign / unassign / multi ===');

    await connectDB();
    await ensureLaserCatalogSeeded();

    const devices = await LaserDevice.find({ active: true }).limit(3).lean();
    check(devices.length >= 2, `need ≥2 active catalog lasers (got ${devices.length})`);
    if (devices.length < 2) return;

    const laserA = String(devices[0]._id);
    const laserB = String(devices[1]._id);

    const ownerId = new mongoose.Types.ObjectId();
    const studioId = new mongoose.Types.ObjectId();
    const room1Id = new mongoose.Types.ObjectId();
    const room2Id = new mongoose.Types.ObjectId();
    await Studio.collection.insertOne({
        _id: studioId,
        firma: `Laser Assign Test ${Date.now()}`,
        email: `laser-assign-${Date.now()}@example.test`,
        studio_code: `LAT${String(Date.now()).slice(-6)}`,
        status: 'aktiv',
        owner: ownerId,
        laser_inventory: [],
        behandlungsraeume: [
            {
                _id: room1Id,
                name: 'Room 1',
                farbe: '#3B8BD4',
                aktiv: true,
                laser_device_ids: [],
                laser_device_id: null,
                laser_brand: '',
                laser_model: '',
                standort_id: '',
            },
            {
                _id: room2Id,
                name: 'Room 2',
                farbe: '#3B8BD4',
                aktiv: true,
                laser_device_ids: [],
                laser_device_id: null,
                laser_brand: '',
                laser_model: '',
                standort_id: '',
            },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    const studio = { _id: studioId };

    try {
        let bad;
        try {
            await assignLaserToStudio({
                studioId: 'InkFree Aesch',
                laserDeviceId: laserA,
            });
        } catch (err) {
            bad = err;
        }
        check(
            bad instanceof ApiError && bad.statusCode === 400,
            'assign with studio name (not ObjectId) → 400 Invalid studio id',
            bad ? `${bad.statusCode || ''} ${bad.message}` : 'no error'
        );

        const first = await assignLaserToStudio({
            studioId,
            laserDeviceId: laserA,
        });
        check(!first.already, 'first assign is new');
        check(studioHasLaser(first.studio, laserA), 'studio has laser A after assign');

        const again = await assignLaserToStudio({
            studioId,
            laserDeviceId: laserA,
        });
        check(again.already === true, 'second assign of same laser is idempotent');

        const second = await assignLaserToStudio({
            studioId,
            laserDeviceId: laserB,
        });
        check(!second.already, 'second different laser assigns');
        check(
            studioHasLaser(second.studio, laserA) && studioHasLaser(second.studio, laserB),
            'studio inventory holds both lasers'
        );

        const listed = await listStudioInventoryDevices(second.studio);
        check(
            listed.length >= 2 &&
                listed.some((d) => d.id === laserA) &&
                listed.some((d) => d.id === laserB),
            `listStudioInventoryDevices returns both (got ${listed.length})`
        );

        const fresh = await Studio.findById(studioId);
        fresh.behandlungsraeume[0].laser_device_ids = [laserA, laserB];
        fresh.behandlungsraeume[0].laser_device_id = laserA;
        fresh.behandlungsraeume[1].laser_device_ids = [laserA];
        fresh.behandlungsraeume[1].laser_device_id = laserA;
        fresh.markModified('behandlungsraeume');
        await fresh.save();

        check(
            roomLaserIds(fresh.behandlungsraeume[0]).length === 2,
            'Room 1 can hold two assigned lasers'
        );
        check(
            roomLaserIds(fresh.behandlungsraeume[1]).includes(laserA),
            'Room 2 can reuse laser A'
        );

        const removed = await unassignLaserFromStudio({
            studioId,
            laserDeviceId: laserA,
        });
        check(removed.removed === true, 'unassign removes laser A');

        const after = await Studio.findById(studioId);
        check(!studioHasLaser(after, laserA), 'inventory no longer has laser A');
        check(studioHasLaser(after, laserB), 'inventory still has laser B');
        check(
            !roomLaserIds(after.behandlungsraeume[0]).includes(laserA),
            'Room 1 lost laser A after unassign'
        );
        check(
            roomLaserIds(after.behandlungsraeume[0]).includes(laserB),
            'Room 1 kept laser B after unassign'
        );
        check(
            roomLaserIds(after.behandlungsraeume[1]).length === 0,
            'Room 2 cleared when its only laser was unassigned'
        );
        check(
            after.behandlungsraeume[1].laser_device_id == null,
            'Room 2 legacy laser_device_id cleared'
        );

        const noop = await unassignLaserFromStudio({
            studioId,
            laserDeviceId: laserA,
        });
        check(noop.removed === false, 'unassign missing laser is a no-op');
    } finally {
        await Studio.deleteOne({ _id: studioId });
    }
};

const main = async () => {
    runUnit();
    try {
        await runIntegration();
    } catch (err) {
        failed += 1;
        console.error('FAIL  integration crashed:', err.message);
        console.error(err.stack);
    } finally {
        if (mongoose.connection.readyState) {
            await mongoose.connection.close();
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exit(1);
    console.log('Studio laser assignment checks passed.');
};

main();

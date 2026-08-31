/**
 * Session numbering moved from per-case to per-zone.
 *
 * The old unique index `{ case, session_number }` would stop two zones of the
 * same tattoo from both having a session 1, so it has to go. The replacement
 * `{ case, zonen_id, session_number }` keeps the same guarantee for
 * single-tattoo cases, where `zonen_id` is null.
 *
 * Idempotent — safe to run repeatedly.
 *
 *   node scripts/migrateSessionZoneIndex.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const OLD_INDEX = 'case_1_session_number_1';
const NEW_KEY = { case: 1, zonen_id: 1, session_number: 1 };
const NEW_INDEX = 'case_1_zonen_id_1_session_number_1';

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const sessions = mongoose.connection.db.collection('sessions');

    const names = (await sessions.indexes()).map((i) => i.name);
    console.log('indexes before:', names.join(', '));

    if (!names.includes(NEW_INDEX)) {
        await sessions.createIndex(NEW_KEY, { unique: true, name: NEW_INDEX });
        console.log(`created ${NEW_INDEX}`);
    } else {
        console.log(`${NEW_INDEX} already present`);
    }

    if (names.includes(OLD_INDEX)) {
        await sessions.dropIndex(OLD_INDEX);
        console.log(`dropped ${OLD_INDEX}`);
    } else {
        console.log(`${OLD_INDEX} already gone`);
    }

    // Normalize any legacy rows so the compound unique index treats them
    // consistently rather than mixing missing and null.
    const normalized = await sessions.updateMany(
        { zonen_id: { $exists: false } },
        { $set: { zonen_id: null } }
    );
    if (normalized.modifiedCount) {
        console.log(`normalized zonen_id on ${normalized.modifiedCount} legacy session(s)`);
    }

    console.log('indexes after:', (await sessions.indexes()).map((i) => i.name).join(', '));
    await mongoose.disconnect();
})().catch((e) => {
    console.error('migration failed:', e.message);
    process.exit(1);
});

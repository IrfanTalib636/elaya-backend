/**
 * Proves the studio dashboard receives `studio:availability_changed`, i.e. that
 * a booking made by a customer reaches a studio client which is only ever in
 * the `availability:studio:{id}` room.
 *
 * Connects two clients — one studio user, one customer — then books and cancels
 * as the customer and reports what each side saw.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { io } = require('../../elaya-mobile/node_modules/socket.io-client');

const User = require('../models/userModel');
const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const { computeAvailability } = require('../utils/lockoutEngine');

const ORIGIN = `http://localhost:${process.env.PORT || 4000}`;
const tokenFor = (userId) =>
    jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });

const connect = async (label, token) => {
    const socket = io(ORIGIN, {
        path: '/socket.io',
        auth: { token },
        transports: ['polling', 'websocket'],
    });
    await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', (e) => reject(new Error(`${label}: ${e.message}`)));
        setTimeout(() => reject(new Error(`${label}: connect timeout`)), 10000);
    });
    console.log(`${label} socket connected`);
    return socket;
};

const main = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const [group] = await Case.aggregate([
        { $match: { customer: { $ne: null }, studio: { $ne: null } } },
        { $group: { _id: { customer: '$customer', studio: '$studio' }, cases: { $push: '$_id' } } },
        { $match: { 'cases.1': { $exists: true } } },
        { $limit: 1 },
    ]);
    const { customer: customerId, studio: studioId } = group._id;

    const [customerUser, studioUser] = await Promise.all([
        User.findOne({ customer_id: customerId }).lean(),
        User.findOne({ studio_id: studioId, role: { $in: ['studio_admin', 'studio_staff'] } }).lean(),
    ]);
    if (!customerUser || !studioUser) {
        console.log('need both a customer and a studio account for this studio');
        return;
    }
    console.log(`customer ${customerUser.email} / studio ${studioUser.email} (studio ${studioId})`);

    const customerToken = tokenFor(customerUser._id);
    const studioSocket = await connect('STUDIO', tokenFor(studioUser._id));
    const customerSocket = await connect('CUSTOMER', customerToken);

    const studioEvents = [];
    const customerEvents = [];
    studioSocket.on('studio:availability_changed', (p) => {
        studioEvents.push(p);
        console.log('  STUDIO   <- studio:availability_changed', JSON.stringify(p));
    });
    customerSocket.on('customer:availability_changed', (p) => {
        customerEvents.push(p);
        console.log('  CUSTOMER <- customer:availability_changed', JSON.stringify(p));
    });

    const caseA = await Case.findById(group.cases[0]);
    const today = new Date().toISOString().slice(0, 10);
    const avail = await computeAvailability({
        activeCaseId: caseA._id,
        customerId,
        consultationOnly: true,
        from: today,
        to: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    });

    const standorte = await (
        await fetch(`${ORIGIN}/api/v1/cases/${caseA._id}/standorte`, {
            headers: { Authorization: `Bearer ${customerToken}` },
        })
    ).json();
    const standortId = standorte?.data?.standorte?.[0]?.id ?? null;

    const book = await fetch(`${ORIGIN}/api/v1/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
            case_id: String(caseA._id),
            date: `${avail.fruehestes}T10:00:00.000Z`,
            time: avail.studio_schedule?.slots?.[0] || '10:00',
            type: 'beratung',
            consultationOnly: true,
            ...(standortId ? { standort_id: standortId } : {}),
        }),
    });
    const bookBody = await book.json();
    console.log(`POST /appointments -> ${book.status}`);
    if (!book.ok) console.log('  ', JSON.stringify(bookBody).slice(0, 300));
    const apptId = bookBody?.data?.appointments?.[0]?.id;

    await new Promise((r) => setTimeout(r, 1500));

    if (apptId) {
        const cancel = await fetch(`${ORIGIN}/api/v1/appointments/${apptId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customerToken}` },
            body: JSON.stringify({ status: 'storniert' }),
        });
        console.log(`PATCH cancel -> ${cancel.status}`);
        await new Promise((r) => setTimeout(r, 1500));
    }

    console.log('\n=== result ===');
    console.log(`studio dashboard events   : ${studioEvents.length} (${studioEvents.map((e) => e.reason).join(', ') || '-'})`);
    console.log(`customer app events       : ${customerEvents.length} (${customerEvents.map((e) => e.reason).join(', ') || '-'})`);

    studioSocket.disconnect();
    customerSocket.disconnect();
    if (apptId) {
        await Appointment.deleteOne({ _id: apptId });
        console.log(`cleaned up appointment ${apptId}`);
    }
    await mongoose.disconnect();
};

main().catch(async (err) => {
    console.error('FAILED:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});

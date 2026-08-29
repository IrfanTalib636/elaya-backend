/**
 * Proves a customer client actually receives `customer:availability_changed`,
 * i.e. that the customer room is joined on connect and the emitter reaches it.
 *
 * Connects as a real customer, then books and cancels an appointment through
 * the HTTP API so the controller emits, and reports what arrived.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
// Borrowed from the mobile app so this check adds no backend dependency.
const { io } = require('../../elaya-mobile/node_modules/socket.io-client');

const User = require('../models/userModel');
const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const { computeAvailability } = require('../utils/lockoutEngine');

const ORIGIN = `http://localhost:${process.env.PORT || 4000}`;

const main = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const [group] = await Case.aggregate([
        { $match: { customer: { $ne: null }, studio: { $ne: null } } },
        { $group: { _id: '$customer', cases: { $push: '$_id' } } },
        { $match: { 'cases.1': { $exists: true } } },
        { $limit: 1 },
    ]);
    const customerId = group._id;

    const user = await User.findOne({ customer_id: customerId }).lean();
    if (!user) {
        console.log('no user account linked to that customer — cannot auth');
        return;
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_ACCESS_SECRET, {
        expiresIn: '15m',
    });

    const caseA = await Case.findById(group.cases[0]);
    // A consultation needs no precheck payload and still runs through the same
    // emit path in createAppointment, which is what this check is about.
    const today = new Date().toISOString().slice(0, 10);
    const availA = await computeAvailability({
        activeCaseId: caseA._id,
        customerId,
        consultationOnly: true,
        from: today,
        to: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
    });

    const received = [];
    const socket = io(ORIGIN, {
        path: '/socket.io',
        auth: { token },
        transports: ['polling', 'websocket'],
    });

    await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
        setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    });
    console.log(`socket connected as customer ${customerId}`);

    socket.on('customer:availability_changed', (payload) => {
        received.push(payload);
        console.log('  <- customer:availability_changed', JSON.stringify(payload));
    });

    const standorteRes = await fetch(`${ORIGIN}/api/v1/cases/${caseA._id}/standorte`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const standorte = await standorteRes.json();
    const standortId = standorte?.data?.standorte?.[0]?.id ?? null;
    console.log(`location for booking: ${standortId ?? '(none)'}`);
    if (!standortId) console.log('  raw:', JSON.stringify(standorte).slice(0, 400));

    const book = await fetch(`${ORIGIN}/api/v1/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            case_id: String(caseA._id),
            date: `${availA.fruehestes}T10:00:00.000Z`,
            time: availA.studio_schedule?.slots?.[0] || '10:00',
            type: 'beratung',
            consultationOnly: true,
            ...(standortId ? { standort_id: standortId } : {}),
        }),
    });
    const bookBody = await book.json();
    console.log(`POST /appointments -> ${book.status}`);
    if (!book.ok) console.log('  ', JSON.stringify(bookBody).slice(0, 300));

    const apptId = bookBody?.data?.appointments?.[0]?.id;

    // Give the fan-out a moment.
    await new Promise((r) => setTimeout(r, 1200));

    if (apptId) {
        const cancel = await fetch(`${ORIGIN}/api/v1/appointments/${apptId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ status: 'storniert' }),
        });
        console.log(`PATCH /appointments/:id (cancel) -> ${cancel.status}`);
        await new Promise((r) => setTimeout(r, 1200));
    }

    console.log('\n=== result ===');
    console.log(`events received by the customer client : ${received.length}`);
    console.log(`reasons                                : ${received.map((e) => e.reason).join(', ') || '-'}`);

    socket.disconnect();
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

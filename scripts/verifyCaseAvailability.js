/**
 * Proves the customer-facing "earliest bookable date" of one Tattoo Case moves
 * on its own when another case of the same customer gets an appointment.
 *
 * Booking is simulated at the model level, exactly the document the appointment
 * controller writes, then availability is recomputed from the rules engine.
 */
require('dotenv').config({ path: `${__dirname}/../.env` });
const mongoose = require('mongoose');

const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const { computeAvailability } = require('../utils/lockoutEngine');
const {
    emitCustomerAvailabilityChanged,
} = require('../sockets/availabilityEmit');

const log = (...args) => console.log(...args);

const summarize = (label, availability) => {
    log(`\n${label}`);
    log(`  earliest bookable : ${availability.fruehestes}`);
    log(`  latest bookable   : ${availability.spaetestes}`);
    if (!availability.sperren.length) {
        log('  blocking periods  : none');
        return;
    }
    for (const s of availability.sperren) {
        log(
            `  blocking period   : kategorie=${s.kategorie ?? '-'} tage=${s.tage ?? '-'} ` +
                `case=${s.case_name ?? '-'} bis=${s.bis}`
        );
    }
};

const main = async () => {
    await mongoose.connect(process.env.MONGO_URI);
    log('mongo connected');

    // A customer with at least two cases in one studio, so a cross-case block
    // can exist at all.
    const [group] = await Case.aggregate([
        { $match: { customer: { $ne: null }, studio: { $ne: null } } },
        { $group: { _id: { customer: '$customer', studio: '$studio' }, cases: { $push: '$_id' } } },
        { $match: { 'cases.1': { $exists: true } } },
        { $limit: 1 },
    ]);

    if (!group) {
        log('no customer with two cases in one studio — cannot test cross-case');
        return;
    }

    const { customer: customerId, studio: studioId } = group._id;
    const [caseA, caseB] = await Promise.all([
        Case.findById(group.cases[0]),
        Case.findById(group.cases[1]),
    ]);
    log(`customer ${customerId}`);
    log(`case A   ${caseA._id} "${caseA.tc_title || caseA.bodyLabel || '-'}"`);
    log(`case B   ${caseB._id} "${caseB.tc_title || caseB.bodyLabel || '-'}"`);

    const availabilityFor = (caseDoc) =>
        computeAvailability({
            activeCaseId: caseDoc._id,
            customerId,
            consultationOnly: false,
        });

    const beforeB = await availabilityFor(caseB);
    summarize('BEFORE — case B as the customer app shows it', beforeB);

    const beforeA = await availabilityFor(caseA);
    summarize('BEFORE — case A', beforeA);

    // Book case A on its own earliest allowed date.
    const bookDate = new Date(`${beforeA.fruehestes}T10:00:00.000Z`);
    const appt = await Appointment.create({
        case: caseA._id,
        customer: customerId,
        studio: studioId,
        date: bookDate,
        day: bookDate.getDate(),
        month: 'Test',
        time: '10:00',
        type: 'treatment',
        status: 'gebucht',
        consultationOnly: false,
        dauer_minuten: 30,
    });
    log(`\n>>> booked case A on ${beforeA.fruehestes} (appointment ${appt._id})`);

    try {
        const afterB = await availabilityFor(caseB);
        summarize('AFTER — case B recomputed', afterB);

        const moved = afterB.fruehestes > beforeB.fruehestes;
        const crossCase = afterB.sperren.find((s) => s.kategorie === 'cross_case');

        log('\n=== result ===');
        log(`case B earliest moved later          : ${moved ? 'YES' : 'no'} (${beforeB.fruehestes} -> ${afterB.fruehestes})`);
        log(`cross-case blocking period reported  : ${crossCase ? 'YES' : 'no'}`);
        if (crossCase) {
            log(`  days                               : ${crossCase.tage}`);
            log(`  caused by case                     : ${crossCase.case_name}`);
            log(`  machine-readable for localization  : kategorie=${crossCase.kategorie}`);
        }

        // The emitter must be safe to call with no socket server attached.
        emitCustomerAvailabilityChanged(customerId, { reason: 'verification' });
        log('emitCustomerAvailabilityChanged callable without io : YES');
    } finally {
        await Appointment.deleteOne({ _id: appt._id });
        log(`\ncleaned up appointment ${appt._id}`);
    }

    await mongoose.disconnect();
};

main().catch(async (err) => {
    console.error('FAILED:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});

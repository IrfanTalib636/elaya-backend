/**
 * One-time dev seed for pagination UI testing.
 * Creates N customers + cases + sessions for the pilot studio (INKFREE by default).
 *
 * Usage:
 *   npm run seed:pagination              # create 30 records (skip if already present)
 *   npm run seed:pagination -- --force     # delete previous pagtest data and recreate
 *   SEED_PAGINATION_COUNT=50 npm run seed:pagination
 */
require('dotenv').config();
const crypto = require('crypto');
const connectDB = require('../config/db');
const User = require('../models/userModel');
const Studio = require('../models/studioModel');
const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const {
    USER_ROLES,
    AKQUISE_QUELLE,
    PIPELINE_STUFE,
    CASE_TYPE,
    CASE_STATUS,
    PAYMENT_CURRENCY,
    PAYMENT_METHOD,
} = require('../config/constants');
const { generateCaseId } = require('../utils/generateCaseId');
const { syncCaseSessionStats } = require('../utils/sessionHelpers');

if (process.env.NODE_ENV === 'production') {
    console.error('seed:pagination must not run in production.');
    process.exit(1);
}

const EMAIL_DOMAIN = 'seed.elaya.test';
const EMAIL_PREFIX = 'pagtest-';
const COUNT = Math.max(1, Number.parseInt(process.env.SEED_PAGINATION_COUNT || '30', 10));
const STUDIO_CODE = process.env.SEED_STUDIO_CODE || 'INKFREE';
const FORCE = process.argv.includes('--force');

const emailFor = (n) => `${EMAIL_PREFIX}${String(n).padStart(2, '0')}@${EMAIL_DOMAIN}`;

const emailFilter = {
    $regex: `^${EMAIL_PREFIX}\\d+@${EMAIL_DOMAIN.replace('.', '\\.')}$`,
};

const PIPELINE_ROTATION = [
    PIPELINE_STUFE.NEU,
    PIPELINE_STUFE.BERATUNG_GEPLANT,
    PIPELINE_STUFE.BEHANDLUNG_AKTIV,
    PIPELINE_STUFE.BERATUNG_ERLEDIGT,
];

const BODY_PARTS = [
    'Unterarm', 'Oberarm', 'Schulter', 'Rücken', 'Bein', 'Knöchel', 'Handgelenk', 'Nacken',
];

const FIRST_NAMES = [
    'Anna', 'Bruno', 'Clara', 'David', 'Elena', 'Felix', 'Greta', 'Hans',
    'Irene', 'Jonas', 'Klara', 'Lukas', 'Maya', 'Noah', 'Olivia', 'Paul',
];

const LAST_NAMES = [
    'Müller', 'Meier', 'Schmid', 'Weber', 'Fischer', 'Huber', 'Wagner', 'Becker',
    'Schneider', 'Meyer', 'Baumann', 'Frei', 'Keller', 'Brunner', 'Graf', 'Steiner',
];

const removePagtestData = async () => {
    const users = await User.find({ email: emailFilter }).select('_id').lean();
    if (!users.length) {
        console.log('No previous pagination test data to remove.');
        return;
    }

    const userIds = users.map((u) => u._id);
    const customers = await Customer.find({ user: { $in: userIds } }).select('_id').lean();
    const customerIds = customers.map((c) => c._id);

    const sessionResult = await Session.deleteMany({ customer: { $in: customerIds } });
    const caseResult = await Case.deleteMany({ customer: { $in: customerIds } });
    const customerResult = await Customer.deleteMany({ _id: { $in: customerIds } });
    const userResult = await User.deleteMany({ _id: { $in: userIds } });

    console.log(
        `Removed pagtest data: ${userResult.deletedCount} users, ${customerResult.deletedCount} customers, ` +
        `${caseResult.deletedCount} cases, ${sessionResult.deletedCount} sessions`
    );
};

const seedPaginationTest = async () => {
    await connectDB();

    const studio = await Studio.findOne({ studio_code: STUDIO_CODE });
    if (!studio) {
        console.error(`Studio "${STUDIO_CODE}" not found. Run npm run seed:dev first.`);
        process.exit(1);
    }

    if (FORCE) {
        await removePagtestData();
    } else {
        const existing = await Customer.countDocuments({
            aktuelle_firma_id: studio._id,
            email: emailFilter,
        });
        if (existing >= COUNT) {
            console.log(
                `Already ${existing} pagination test customers for ${STUDIO_CODE} ` +
                `(target ${COUNT}). Use --force to recreate.`
            );
            process.exit(0);
        }
    }

    const existingCaseIds = await Case.find({ studio: studio._id }).distinct('caseId');
    const caseIdPool = [...existingCaseIds];
    const tempPassword = crypto.randomBytes(16).toString('hex');

    let createdCustomers = 0;
    let createdCases = 0;
    let createdSessions = 0;

    for (let i = 1; i <= COUNT; i += 1) {
        const email = emailFor(i);

        if (!FORCE && await User.exists({ email })) {
            continue;
        }

        const user = await User.create({
            email,
            password: tempPassword,
            role: USER_ROLES.CUSTOMER,
        });

        const customer = await Customer.create({
            user: user._id,
            vorname: FIRST_NAMES[(i - 1) % FIRST_NAMES.length],
            nachname: `${LAST_NAMES[(i - 1) % LAST_NAMES.length]}-${String(i).padStart(2, '0')}`,
            email,
            telefon: `+41 79 ${String(1000000 + i).slice(-7)}`,
            akquise_quelle: AKQUISE_QUELLE.STUDIO_EIGEN,
            aktuelle_firma_id: studio._id,
            pipeline_stufe: PIPELINE_ROTATION[(i - 1) % PIPELINE_ROTATION.length],
            stufe_seit: new Date(),
            notizen: 'Pagination test seed — safe to delete',
        });

        await User.findByIdAndUpdate(user._id, { customer_id: customer._id });
        createdCustomers += 1;

        const bodyLabel = `${BODY_PARTS[(i - 1) % BODY_PARTS.length]} ${i}`;
        const caseId = generateCaseId(bodyLabel, caseIdPool);
        caseIdPool.push(caseId);

        const caseDoc = await Case.create({
            customer: customer._id,
            studio: studio._id,
            caseId,
            type: i % 5 === 0 ? CASE_TYPE.PMU : CASE_TYPE.TATTOO,
            bodyLabel,
            tc_title: bodyLabel,
            sessions: 6,
            sessionsMin: 4,
            sessionsMax: 8,
            sessionsDone: 1,
            status: CASE_STATUS.ACTIVE,
            akquise_quelle: AKQUISE_QUELLE.STUDIO_EIGEN,
            pricePerSession: 150,
            lastSessionDate: new Date(Date.now() - i * 86400000),
        });
        createdCases += 1;

        const treatmentDate = new Date(Date.now() - i * 86400000);

        await Session.create({
            case: caseDoc._id,
            customer: customer._id,
            studio: studio._id,
            session_number: 1,
            session_id: `${caseId}-S1`,
            treatment_date: treatmentDate,
            treatment_time: '10:00',
            verblassung_prozent: Math.min(90, 10 + (i % 8) * 10),
            removal_pct: Math.min(90, 10 + (i % 8) * 10),
            is_draft: false,
            is_no_show: false,
            zahlung: {
                betrag: 150,
                betragCHF: 150,
                waehrung: PAYMENT_CURRENCY.CHF,
                zahlungsart: PAYMENT_METHOD.BAR,
            },
        });
        createdSessions += 1;

        await syncCaseSessionStats(caseDoc._id);
    }

    console.log('');
    console.log(`Pagination test seed complete for studio ${STUDIO_CODE}`);
    console.log(`  Customers: ${createdCustomers}`);
    console.log(`  Cases:     ${createdCases}`);
    console.log(`  Sessions:  ${createdSessions}`);
    console.log('');
    console.log('Log in as studio admin and open Kunden / Fälle / Sitzungen — you should see page 2+.');
    console.log(`Remove later: npm run seed:pagination -- --force (recreates) or delete *@${EMAIL_DOMAIN} users.`);

    process.exit(0);
};

seedPaginationTest().catch((err) => {
    console.error(err);
    process.exit(1);
});

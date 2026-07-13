/**
 * Financier demo seed — complete tattoo cases with lockout demo state.
 *
 * Creates for one demo customer:
 *   #TRI-001 — tribal arm (same-case 49-day lockout from session ~35 days ago)
 *   #HAN-001 — wrist (cross-case 28-day lockout from session ~12 days ago)
 *
 * Usage:
 *   npm run seed:demo
 *   SEED_STUDIO_CODE=INKFREE npm run seed:demo
 *   npm run seed:demo -- --force
 *
 * On VPS (production): set SEED_DEMO_ALLOW_PRODUCTION=1
 */
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/userModel');
const Studio = require('../models/studioModel');
const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const {
    USER_ROLES,
    USER_STATUS,
    AKQUISE_QUELLE,
    PIPELINE_STUFE,
    CASE_TYPE,
    CASE_STATUS,
    TC_TYPE,
    TC_COVERUP,
    GOAL_TARGET,
    APPOINTMENT_STATUS,
    APPOINTMENT_TYPE,
    PAYMENT_CURRENCY,
    PAYMENT_METHOD,
} = require('../config/constants');
const { calculatePrice } = require('../utils/pricingEngine');
const { getEffectivePricingOverrides } = require('../utils/configService');
const { syncCaseSessionStats } = require('../utils/sessionHelpers');

const STUDIO_CODE = process.env.SEED_STUDIO_CODE || 'INKFREE';
const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL || 'demo.tribal@elaya.ch';
const FORCE = process.argv.includes('--force');

const DEMO_CASES = [
    {
        caseId: '#TRI-001',
        tc_title: 'Tribal',
        bodyLabel: 'Unterarm links',
        tc_colors_present: ['Rot', 'Grün', 'Schwarz'],
        tc_size_length: 9,
        tc_size_width: 9,
        tc_type: TC_TYPE.PROFESSIONAL,
        tc_age_years: 7,
        skin_fitzpatrick: 3,
        goal_target: GOAL_TARGET.FULL,
        sessions: 7,
        sessionsMin: 4,
        sessionsMax: 7,
        sessionDaysAgo: 35,
        sessionNote: '49-day same-case lockout',
    },
    {
        caseId: '#HAN-001',
        tc_title: 'Handgelenk',
        bodyLabel: 'Handgelenk',
        tc_colors_present: ['Schwarz'],
        tc_size_length: 3,
        tc_size_width: 4,
        tc_type: TC_TYPE.AMATEUR,
        tc_age_years: 5,
        skin_fitzpatrick: 2,
        goal_target: GOAL_TARGET.PARTIAL_FADE,
        sessions: 6,
        sessionsMin: 5,
        sessionsMax: 8,
        sessionDaysAgo: 12,
        sessionNote: '28-day cross-case lockout (visible on #TRI-001)',
    },
];

if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_ALLOW_PRODUCTION !== '1') {
    console.error('seed:demo blocked in production. Set SEED_DEMO_ALLOW_PRODUCTION=1 to run on VPS.');
    process.exit(1);
}

const MONTHS_DE = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

const formatMonthDe = (date) => `${MONTHS_DE[date.getMonth()]} ${date.getFullYear()}`;

const daysAgo = (n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d;
};

const DEMO_CASE_IDS = DEMO_CASES.map((c) => c.caseId);

const removeDemoData = async (studioId) => {
    const demoCases = await Case.find({
        studio: studioId,
        caseId: { $in: DEMO_CASE_IDS },
    }).select('_id caseId').lean();

    if (demoCases.length === 0) return;

    const caseIds = demoCases.map((c) => c._id);
    await Session.deleteMany({ case: { $in: caseIds } });
    await Appointment.deleteMany({ case: { $in: caseIds } });
    console.log(`Removed sessions/appointments for ${demoCases.map((c) => c.caseId).join(', ')}`);
};

/** Remove duplicate demo cases left on other studios (e.g. after re-seeding with INKFREE). */
const removeOrphanDemoCases = async (customerId, keepStudioId) => {
    const orphans = await Case.find({
        customer: customerId,
        caseId: { $in: DEMO_CASE_IDS },
        studio: { $ne: keepStudioId },
    }).select('_id caseId studio').lean();

    if (orphans.length === 0) return;

    const orphanIds = orphans.map((c) => c._id);
    await Session.deleteMany({ case: { $in: orphanIds } });
    await Appointment.deleteMany({ case: { $in: orphanIds } });
    await Case.deleteMany({ _id: { $in: orphanIds } });
    console.log(
        `Removed orphan demo cases from other studios: ${orphans.map((c) => c.caseId).join(', ')}`
    );
};

const upsertDemoCase = async (studioId, customerId, spec, pricingOverrides) => {
    const caseFields = {
        customer: customerId,
        studio: studioId,
        caseId: spec.caseId,
        type: CASE_TYPE.TATTOO,
        tc_title: spec.tc_title,
        bodyLabel: spec.bodyLabel,
        tc_colors_present: spec.tc_colors_present,
        tc_size_length: spec.tc_size_length,
        tc_size_width: spec.tc_size_width,
        tc_type: spec.tc_type,
        tc_age_years: spec.tc_age_years,
        skin_fitzpatrick: spec.skin_fitzpatrick,
        tc_coverup: TC_COVERUP.NONE,
        goal_target: spec.goal_target,
        sessions: spec.sessions,
        sessionsMin: spec.sessionsMin,
        sessionsMax: spec.sessionsMax,
        status: CASE_STATUS.ACTIVE,
        akquise_quelle: AKQUISE_QUELLE.STUDIO_EIGEN,
    };

    let caseDoc = await Case.findOne({ studio: studioId, caseId: spec.caseId });
    if (caseDoc) {
        Object.assign(caseDoc, caseFields);
        await caseDoc.save();
        console.log(`Updated existing case ${spec.caseId}.`);
    } else {
        caseDoc = await Case.create({
            ...caseFields,
            sessionsDone: 0,
            removal: 0,
            healing: 0,
            pricePerSession: 0,
        });
        console.log(`Created case ${spec.caseId}.`);
    }

    const pricing = calculatePrice(caseDoc.toObject(), pricingOverrides);
    if (pricing.pricePerSession !== caseDoc.pricePerSession) {
        caseDoc.pricePerSession = pricing.pricePerSession;
        caseDoc.sessions = caseDoc.sessionsMax || spec.sessionsMax;
        await caseDoc.save();
    }

    const sessionExists = await Session.exists({
        case: caseDoc._id,
        session_number: 1,
        is_draft: false,
        is_no_show: false,
    });

    if (!sessionExists || FORCE) {
        if (sessionExists && FORCE) {
            await Session.deleteMany({ case: caseDoc._id, session_number: 1 });
        }

        const treatmentDate = daysAgo(spec.sessionDaysAgo);

        await Session.create({
            case: caseDoc._id,
            customer: customerId,
            studio: studioId,
            session_number: 1,
            session_id: `${spec.caseId}-S1`,
            treatment_date: treatmentDate,
            treatment_time: '10:30',
            dauer_minuten: 45,
            laser_typ: 'Nd:YAG',
            studio_laser_brand: 'Candela',
            studio_laser_model: 'GentleMax Pro',
            wavelength_nm: [1064, 532],
            fluence_j_cm2: 6.5,
            spot_size_mm: 4,
            frequency_hz: 2,
            pass_count: 2,
            cooling_used: true,
            endpoint_reaction: 'Weiss werden',
            pain_score_0_10: 4,
            removal_pct: spec.caseId === '#TRI-001' ? 12 : 8,
            verblassung_prozent: spec.caseId === '#TRI-001' ? 15 : 10,
            is_draft: false,
            is_no_show: false,
            zahlung: {
                betrag: pricing.pricePerSession,
                betragCHF: pricing.pricePerSession,
                waehrung: PAYMENT_CURRENCY.CHF,
                zahlungsart: PAYMENT_METHOD.BAR,
            },
        });
        console.log(
            `Session 1 on ${spec.caseId} (${treatmentDate.toISOString().slice(0, 10)} — ${spec.sessionNote}).`
        );
    } else {
        console.log(`Session 1 on ${spec.caseId} already exists — skipped (use --force to recreate).`);
    }

    await syncCaseSessionStats(caseDoc._id);
    return caseDoc;
};

const seedDemo = async () => {
    await connectDB();

    const studio = await Studio.findOne({ studio_code: STUDIO_CODE });
    if (!studio) {
        console.error(`Studio "${STUDIO_CODE}" not found.`);
        process.exit(1);
    }

    if (FORCE) {
        await removeDemoData(studio._id);
    }

    let user = await User.findOne({ email: DEMO_EMAIL });
    if (!user) {
        user = await User.create({
            email: DEMO_EMAIL,
            password: process.env.SEED_DEMO_PASSWORD || 'Demo1234!',
            role: USER_ROLES.CUSTOMER,
            status: USER_STATUS.AKTIV,
        });
        console.log(`Demo customer user created: ${DEMO_EMAIL}`);
    }

    let customer = await Customer.findOne({ email: DEMO_EMAIL });
    if (!customer) {
        customer = await Customer.create({
            user: user._id,
            vorname: 'Maria',
            nachname: 'Tribal',
            email: DEMO_EMAIL,
            telefon: '+41 79 555 01 01',
            akquise_quelle: AKQUISE_QUELLE.STUDIO_EIGEN,
            aktuelle_firma_id: studio._id,
            pipeline_stufe: PIPELINE_STUFE.BEHANDLUNG_AKTIV,
            stufe_seit: new Date(),
            notizen: 'Financier demo — #TRI-001 + #HAN-001 lockout cases',
        });
        await User.findByIdAndUpdate(user._id, { customer_id: customer._id });
        console.log('Demo customer profile created.');
    } else if (String(customer.aktuelle_firma_id) !== String(studio._id)) {
        customer.aktuelle_firma_id = studio._id;
        await customer.save();
        console.log('Demo customer studio link fixed.');
    }

    await removeOrphanDemoCases(customer._id, studio._id);

    const pricingOverrides = await getEffectivePricingOverrides(studio._id);
    const caseDocs = [];

    for (const spec of DEMO_CASES) {
        const caseDoc = await upsertDemoCase(studio._id, customer._id, spec, pricingOverrides);
        caseDocs.push(caseDoc);
    }

    const primaryCase = caseDocs.find((c) => c.caseId === '#TRI-001') ?? caseDocs[0];

    const apptExists = await Appointment.exists({
        case: primaryCase._id,
        status: APPOINTMENT_STATUS.GEBUCHT,
        date: { $gte: daysAgo(0) },
    });

    if (!apptExists) {
        const apptDate = daysAgo(-14);
        apptDate.setHours(0, 0, 0, 0);

        await Appointment.create({
            case: primaryCase._id,
            customer: customer._id,
            studio: studio._id,
            day: apptDate.getDate(),
            month: formatMonthDe(apptDate),
            time: '09:00',
            date: apptDate,
            status: APPOINTMENT_STATUS.GEBUCHT,
            type: APPOINTMENT_TYPE.TREATMENT,
            consultationOnly: false,
            dauer_minuten: 60,
            gruppen_termin: false,
            gruppen_cases: [primaryCase._id],
        });
        console.log(`Future appointment on #TRI-001 (${apptDate.toISOString().slice(0, 10)}).`);
    }

    console.log('');
    console.log('Demo seed complete');
    console.log(`  Studio:   ${studio.firma} (${STUDIO_CODE}) — ${studio._id}`);
    console.log(`  Customer: ${customer.vorname} ${customer.nachname} — ${customer._id}`);
    for (const c of caseDocs) {
        console.log(`  Case:     ${c.caseId} — ${c._id}`);
    }
    console.log('');
    console.log('Demo flow on #TRI-001:');
    console.log('  1. Buchbarkeit panel → 49-day (same case) + 28-day (cross from #HAN-001)');
    console.log('  2. Book Behandlung before fruehestes → blocked');
    console.log('  3. Book Beratung today → allowed');
    console.log('  4. Pre-session check → UV/meds extend fruehestes');

    process.exit(0);
};

seedDemo().catch((err) => {
    console.error(err);
    process.exit(1);
});

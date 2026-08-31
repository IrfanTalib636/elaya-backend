/**
 * Per-zone session logging, aftercare and progress rollup.
 *
 *   node scripts/verifyZoneTracking.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:4000/api/v1';

let fails = 0;
const check = (label, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    if (!cond) fails += 1;
};

const api = async (method, path, token, body) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
};

const iso = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
};

const zone = (over = {}) => ({
    bezeichnung: 'Oberarm innen',
    koerperstelle: 'unterarm',
    farben: ['schwarz'],
    laenge_cm: 10,
    breite_cm: 5,
    ...over,
});

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const Case = require('../models/caseModel');
    const CaseZone = require('../models/caseZoneModel');
    const Session = require('../models/sessionModel');
    const NachsorgeCheck = require('../models/nachsorgeCheckModel');
    const User = require('../models/userModel');

    const tokenFor = (user) =>
        jwt.sign({ userId: String(user._id) }, process.env.JWT_ACCESS_SECRET, {
            expiresIn: '15m',
        });

    const customerUser = await User.findOne({
        role: 'customer',
        customer_id: { $ne: null },
    }).lean();
    if (!customerUser) throw new Error('no customer user');
    const customerToken = tokenFor(customerUser);

    const studioUser = await User.findOne({ role: 'studio_admin' }).lean();
    if (!studioUser) throw new Error('no studio_admin user');
    const studioToken = tokenFor(studioUser);

    // A zone case and a plain single-tattoo case, for contrast.
    const zoneCase = await api('POST', '/cases', customerToken, {
        type: 'tattoo',
        status: 'draft',
        zonen_aktiv: true,
        zonen: [zone(), zone({ bezeichnung: 'Wade', laenge_cm: 4, breite_cm: 3 })],
    });
    if (![200, 201].includes(zoneCase.status)) {
        throw new Error(`zone case create failed: ${zoneCase.status} ${JSON.stringify(zoneCase.json)}`);
    }
    const zoneCaseId = zoneCase.json.data.case.id || zoneCase.json.data.case._id;

    const plainCase = await api('POST', '/cases', customerToken, {
        type: 'tattoo',
        status: 'draft',
        tc_size_length: 10,
        tc_size_width: 5,
    });
    const plainCaseId = plainCase.json?.data?.case?.id || plainCase.json?.data?.case?._id;

    const createdSessions = [];

    try {
        // ── Zone assignment is enforced ──────────────────────────────────
        const noZone = await api('POST', '/sessions', studioToken, {
            case_id: zoneCaseId,
            treatment_date: iso(-40),
        });
        check(
            'a zone case refuses a session with no zone',
            [400, 422].includes(noZone.status),
            `status ${noZone.status}`
        );

        const badZone = await api('POST', '/sessions', studioToken, {
            case_id: zoneCaseId,
            treatment_date: iso(-40),
            zonen_id: 'Z999',
        });
        check(
            'a session on a zone that is not on the case is refused',
            [400, 422].includes(badZone.status),
            `status ${badZone.status}`
        );

        if (plainCaseId) {
            const zoneOnPlain = await api('POST', '/sessions', studioToken, {
                case_id: plainCaseId,
                treatment_date: iso(-40),
                zonen_id: 'Z001',
            });
            check(
                'a single-tattoo case refuses a zone reference',
                [400, 422].includes(zoneOnPlain.status),
                `status ${zoneOnPlain.status}`
            );
        }

        // ── Per-zone session numbering ───────────────────────────────────
        const mk = async (zonenId, day, fade) => {
            const res = await api('POST', '/sessions', studioToken, {
                case_id: zoneCaseId,
                treatment_date: iso(day),
                zonen_id: zonenId,
                ...(fade != null ? { verblassung_prozent: fade } : {}),
            });
            if (res.status === 201) {
                createdSessions.push(res.json.data.session.id);
            }
            return res;
        };

        const z1s1 = await mk('Z001', -60, 20);
        const z2s1 = await mk('Z002', -58, 10);
        check('session logged on zone 1', z1s1.status === 201, `status ${z1s1.status}`);
        check('session logged on zone 2', z2s1.status === 201, `status ${z2s1.status}`);
        check(
            'both zones start at session 1 independently',
            z1s1.json?.data?.session?.session_number === 1 &&
                z2s1.json?.data?.session?.session_number === 1,
            `z1=${z1s1.json?.data?.session?.session_number} z2=${z2s1.json?.data?.session?.session_number}`
        );
        check(
            'the session carries its zone back to the client',
            z1s1.json?.data?.session?.zonen_id === 'Z001',
            `zonen_id=${z1s1.json?.data?.session?.zonen_id}`
        );

        const z1s2 = await mk('Z001', -20, 45);
        check(
            'zone 1 advances to session 2 while zone 2 stays at 1',
            z1s2.json?.data?.session?.session_number === 2,
            `z1 next=${z1s2.json?.data?.session?.session_number}`
        );

        // ── A session cannot be moved between zones ──────────────────────
        const moved = await api('PATCH', `/sessions/${z1s1.json.data.session.id}`, studioToken, {
            zonen_id: 'Z002',
        });
        check(
            'a logged session cannot be reassigned to another zone',
            [400, 422].includes(moved.status),
            `status ${moved.status}`
        );

        // ── Sessions can be listed per zone ──────────────────────────────
        const listed = await api(
            'GET',
            `/sessions?case_id=${zoneCaseId}&zonen_id=Z001&limit=50`,
            studioToken
        );
        const rows = listed.json?.data?.sessions || [];
        check(
            'sessions can be filtered to one zone',
            listed.status === 200 && rows.length === 2 && rows.every((s) => s.zonen_id === 'Z001'),
            `status ${listed.status}, ${rows.length} row(s)`
        );

        // ── Progress rolls up per zone ───────────────────────────────────
        const zones = await CaseZone.find({ case: zoneCaseId }).sort({ zonen_id: 1 }).lean();
        const byId = Object.fromEntries(zones.map((z) => [z.zonen_id, z]));
        check(
            'zone 1 progress reflects its own sessions',
            byId.Z001?.sitzungen_erledigt === 2,
            `sitzungen_erledigt=${byId.Z001?.sitzungen_erledigt}`
        );
        check(
            'zone 2 progress reflects its own sessions',
            byId.Z002?.sitzungen_erledigt === 1,
            `sitzungen_erledigt=${byId.Z002?.sitzungen_erledigt}`
        );
        check(
            'each zone keeps its own last-session date',
            !!byId.Z001?.letzte_sitzung && !!byId.Z002?.letzte_sitzung,
            `Z001=${byId.Z001?.letzte_sitzung?.toISOString?.().slice(0, 10)} Z002=${byId.Z002?.letzte_sitzung?.toISOString?.().slice(0, 10)}`
        );
        check(
            'a zone with no comparable photos reports no measured progress',
            byId.Z001?.fortschritt_prozent === 0,
            `Z001 fortschritt=${byId.Z001?.fortschritt_prozent}%`
        );

        // With a comparable measurement on record, the rollup must surface it —
        // and must not bleed one zone's percentage into the other.
        const { syncCaseSessionStats } = require('../utils/sessionHelpers');
        await Session.updateOne(
            { _id: z1s2.json.data.session.id },
            { $set: { comparison_eligible: true, verblassung_prozent: 45, removal_pct: 45 } }
        );
        await Session.updateOne(
            { _id: z2s1.json.data.session.id },
            { $set: { comparison_eligible: true, verblassung_prozent: 10, removal_pct: 10 } }
        );
        await syncCaseSessionStats(zoneCaseId);

        const rolled = Object.fromEntries(
            (await CaseZone.find({ case: zoneCaseId }).lean()).map((z) => [z.zonen_id, z])
        );
        check(
            'a comparable measurement rolls up onto its own zone',
            rolled.Z001?.fortschritt_prozent === 45 && rolled.Z002?.fortschritt_prozent === 10,
            `Z001=${rolled.Z001?.fortschritt_prozent}% Z002=${rolled.Z002?.fortschritt_prozent}%`
        );

        // The customer-facing case payload should carry the real numbers.
        const detail = await api('GET', `/cases/${zoneCaseId}`, customerToken);
        const apiZones = detail.json?.data?.case?.zonen || [];
        check(
            'the customer sees per-zone progress on the case',
            apiZones.length === 2 &&
                apiZones.find((z) => z.zonen_id === 'Z001')?.fortschritt_prozent === 45 &&
                apiZones.find((z) => z.zonen_id === 'Z002')?.fortschritt_prozent === 10,
            apiZones.map((z) => `${z.zonen_id}:${z.fortschritt_prozent}%`).join(', ')
        );

        // ── Fading compares within a zone ────────────────────────────────
        const z1s2Doc = await Session.findById(z1s2.json.data.session.id).lean();
        const prevOfZ1s2 = await Session.findOne({
            case: zoneCaseId,
            zonen_id: 'Z001',
            session_number: { $lt: z1s2Doc.session_number },
            is_draft: false,
            is_no_show: false,
        })
            .sort({ session_number: -1 })
            .lean();
        check(
            "a zone's session 2 compares against session 1 of the SAME zone",
            prevOfZ1s2 && String(prevOfZ1s2._id) === String(z1s1.json.data.session.id),
            `previous=${prevOfZ1s2?.zonen_id} #${prevOfZ1s2?.session_number}`
        );

        // ── Aftercare is per zone ────────────────────────────────────────
        const acNoZone = await api('POST', '/nachsorge/check', customerToken, {
            case_id: zoneCaseId,
            foto_file_id: '0'.repeat(24),
        });
        check(
            'an aftercare check on a zone case requires a zone',
            [400, 422].includes(acNoZone.status),
            `status ${acNoZone.status}`
        );

        const acBadZone = await api('POST', '/nachsorge/check', customerToken, {
            case_id: zoneCaseId,
            zonen_id: 'Z999',
            foto_file_id: '0'.repeat(24),
        });
        check(
            'an aftercare check on an unknown zone is refused',
            [400, 422].includes(acBadZone.status),
            `status ${acBadZone.status}`
        );

        // The zone reaches the DB and comes back out, without needing a real
        // photo + AI round trip.
        const seeded = await NachsorgeCheck.create({
            customer: customerUser.customer_id,
            case: zoneCaseId,
            zonen_id: 'Z002',
            studio: studioUser.studio_id,
            ampel: 'gruen',
            titel: 'Zone check',
        });
        const acList = await api(
            'GET',
            `/nachsorge?case_id=${zoneCaseId}&zonen_id=Z002&limit=50`,
            customerToken
        );
        const acRows = acList.json?.data?.checks || [];
        check(
            'aftercare history can be filtered to one zone',
            acList.status === 200 &&
                acRows.length === 1 &&
                acRows[0].zonen_id === 'Z002',
            `status ${acList.status}, ${acRows.length} row(s), zone=${acRows[0]?.zonen_id}`
        );
        await NachsorgeCheck.deleteOne({ _id: seeded._id });

        console.log(fails ? '\nFAILED' : '\nALL PASSED');
    } finally {
        await Session.deleteMany({ case: { $in: [zoneCaseId, plainCaseId].filter(Boolean) } });
        await NachsorgeCheck.deleteMany({ case: zoneCaseId });
        await CaseZone.deleteMany({ case: zoneCaseId });
        await Case.deleteMany({ _id: { $in: [zoneCaseId, plainCaseId].filter(Boolean) } });
        await mongoose.disconnect();
    }

    process.exit(fails ? 1 : 0);
})().catch((e) => {
    console.error('ERR', e.message);
    process.exit(1);
});

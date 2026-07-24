const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const Anamnesis = require('../models/anamnesisModel');
const Studio = require('../models/studioModel');
const { computeAvailability } = require('../utils/lockoutEngine');
const { APPOINTMENT_STATUS, CASE_STATUS } = require('../config/constants');

const formatDeDate = (value) => {
    if (!value) return '—';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('de-CH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
};

const heuteLabel = () => formatDeDate(new Date());

/**
 * Build customer profile context for Elaya FAB (prototype buildAssistantContext parity).
 */
const buildCustomerChatContext = async (customerId, focusCaseId = null) => {
    const customer = await Customer.findById(customerId)
        .select('vorname nachname geburtsdatum ort elaycoins.balance')
        .lean();
    if (!customer) return `Heute: ${heuteLabel()}\nKein Kundenprofil gefunden.`;

    let caseFilter = { customer: customerId };
    if (focusCaseId) caseFilter._id = focusCaseId;

    const cases = await Case.find(caseFilter)
        .select(
            'caseId tc_title bodyLabel sessions sessionsDone sessionsMax removal lastSessionDate medical_flag_level pricePerSession skin_fitzpatrick status'
        )
        .sort({ updatedAt: -1 })
        .limit(focusCaseId ? 1 : 12)
        .lean();

    const caseIds = cases.map((c) => c._id);
    const [sessions, appointments, anamneses] = await Promise.all([
        Session.find({
            case: { $in: caseIds },
            is_draft: false,
            is_no_show: false,
        })
            .select(
                'case session_number treatment_date verblassung_prozent verblassung_ki.beurteilung'
            )
            .sort({ treatment_date: -1 })
            .lean(),
        Appointment.find({
            case: { $in: caseIds },
            status: {
                $nin: [APPOINTMENT_STATUS.STORNIERT, APPOINTMENT_STATUS.CANCELLED],
            },
        })
            .select('case date time status')
            .sort({ date: 1 })
            .lean(),
        Anamnesis.find({ case: { $in: caseIds } })
            .select('case ampel_status')
            .lean(),
    ]);

    const sessionsByCase = new Map();
    for (const s of sessions) {
        const key = String(s.case);
        if (!sessionsByCase.has(key)) sessionsByCase.set(key, []);
        sessionsByCase.get(key).push(s);
    }
    const anamByCase = new Map(anamneses.map((a) => [String(a.case), a]));
    const apptsByCase = new Map();
    for (const a of appointments) {
        const key = String(a.case);
        if (!apptsByCase.has(key)) apptsByCase.set(key, []);
        apptsByCase.get(key).push(a);
    }

    let ctx = `Heute: ${heuteLabel()}\nKunde: ${(customer.vorname || '')} ${(customer.nachname || '')}`.trim();
    if (customer.geburtsdatum) ctx += `, geb. ${formatDeDate(customer.geburtsdatum)}`;
    if (customer.ort) ctx += `, ${customer.ort}`;
    if (customer.elaycoins?.balance != null) {
        ctx += `\nElaycoins: ${customer.elaycoins.balance}`;
    }
    ctx += '\n\n';

    if (!cases.length) {
        ctx += 'Noch keine Cases erfasst.\n';
        return ctx;
    }

    for (const c of cases) {
        const titel = c.tc_title || c.bodyLabel || 'Case';
        ctx += `--- Case: ${titel}${c.caseId ? ` (${c.caseId})` : ''} ---\n`;
        ctx += `Sitzungen: ${c.sessionsDone || 0} gemacht`;
        if (c.sessions || c.sessionsMax) {
            ctx += ` von ca. ${c.sessions || c.sessionsMax} geschätzten`;
        }
        ctx += '\n';
        if (c.removal != null) ctx += `Verblassung (Case): ${c.removal}%\n`;
        if (c.pricePerSession != null && c.pricePerSession > 0) {
            ctx += `Preis pro Sitzung (Studio): CHF ${c.pricePerSession}\n`;
        }

        const anam = anamByCase.get(String(c._id));
        if (anam || c.medical_flag_level) {
            ctx += `Anamnese: Ampel=${anam?.ampel_status || c.medical_flag_level || '—'}`;
            if (c.skin_fitzpatrick) {
                ctx += `, Fitzpatrick=${c.skin_fitzpatrick}`;
            }
            ctx += '\n';
        }

        const caseSessions = sessionsByCase.get(String(c._id)) || [];
        if (caseSessions.length) {
            const last = caseSessions[0];
            ctx += `Letzte Sitzung: S.${last.session_number || '?'} am ${formatDeDate(last.treatment_date)}`;
            if (last.verblassung_prozent != null) {
                ctx += `, ${last.verblassung_prozent}% verblasst`;
            }
            ctx += '\n';
            const kiT = last.verblassung_ki?.beurteilung;
            if (kiT) ctx += `KI-Analyse: ${String(kiT).slice(0, 180)}\n`;
        }

        try {
            const avail = await computeAvailability({
                activeCaseId: c._id,
                customerId,
            });
            if (avail.sperren?.length) {
                ctx += `Aktive Sperren: ${avail.sperren
                    .map((s) => `${s.grund || s.typ || 'Sperre'} bis ${s.bis_string || s.bis || ''}`)
                    .join('; ')}\n`;
            }
            if (avail.fruehestes) {
                ctx += `Frühestes Buchungsdatum: ${formatDeDate(avail.fruehestes)}\n`;
            }
        } catch {
            /* lockout optional for chat context */
        }

        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const upcoming = (apptsByCase.get(String(c._id)) || []).filter(
            (a) => a.date && new Date(a.date) >= now
        );
        if (upcoming.length) {
            ctx += `Kommende Termine: ${upcoming
                .map((a) => `${formatDeDate(a.date)}${a.time ? ` ${a.time} Uhr` : ''}`)
                .join(', ')}\n`;
        }
        ctx += '\n';
    }

    return ctx;
};

/**
 * Build studio assistant context (compact — active customers/cases for this studio).
 */
const buildStudioChatContext = async (studioId) => {
    const studio = await Studio.findById(studioId)
        .select('firma studio_code ort standorte')
        .lean();
    let ctx = `Heute: ${heuteLabel()}\nStudio: ${studio?.firma || studio?.studio_code || 'Studio'}`;
    if (studio?.ort) ctx += `\nOrt: ${studio.ort}`;
    const standorte = (studio?.standorte || []).map((s) => s.name).filter(Boolean);
    if (standorte.length) ctx += `\nStandorte: ${standorte.join(', ')}`;
    ctx += '\n\n';

    const cases = await Case.find({
        studio: studioId,
        status: { $nin: [CASE_STATUS.COMPLETED, CASE_STATUS.LOESCHANTRAG_AUSSTEHEND] },
    })
        .select('caseId tc_title bodyLabel sessionsDone removal customer status')
        .populate({ path: 'customer', select: 'vorname nachname' })
        .sort({ updatedAt: -1 })
        .limit(40)
        .lean();

    if (!cases.length) {
        ctx += 'Noch keine aktiven Cases.\n';
        return ctx;
    }

    const byCustomer = new Map();
    for (const c of cases) {
        const cid = String(c.customer?._id || c.customer);
        if (!byCustomer.has(cid)) {
            byCustomer.set(cid, {
                name: c.customer
                    ? `${c.customer.vorname || ''} ${c.customer.nachname || ''}`.trim()
                    : 'Kunde',
                cases: [],
            });
        }
        byCustomer.get(cid).cases.push(c);
    }

    for (const ku of byCustomer.values()) {
        ctx += `--- Kunde: ${ku.name} (${ku.cases.length} aktive Case${ku.cases.length === 1 ? '' : 's'}) ---\n`;
        for (const c of ku.cases) {
            const titel = c.tc_title || c.bodyLabel || 'Case';
            ctx += `  • ${titel}${c.caseId ? ` (${c.caseId})` : ''}: ${c.sessionsDone || 0} Sitzung(en)`;
            if (c.removal != null) ctx += ` · ${c.removal}% verblasst`;
            ctx += '\n';
        }
        ctx += '\n';
    }

    return ctx;
};

module.exports = {
    buildCustomerChatContext,
    buildStudioChatContext,
};

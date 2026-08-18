const Appointment = require('../models/appointmentModel');
const Session = require('../models/sessionModel');
const Case = require('../models/caseModel');
const Customer = require('../models/customerModel');
const Anamnesis = require('../models/anamnesisModel');
const CrmNote = require('../models/crmNoteModel');
const NachsorgeCheck = require('../models/nachsorgeCheckModel');
const ActivityEvent = require('../models/activityEventModel');
const { APPOINTMENT_STATUS, APPOINTMENT_TYPE } = require('../config/constants');
const {
    ACTIVITY_CATEGORY,
    CASE_ACTIVITY_TYPE_MAP,
    TAG_FOR_CATEGORY,
} = require('../config/activityConfig');
const { caseLabel, formatApptStamp } = require('./activityLog');

const FETCH_CAP = 800;

const buildDateFilter = (from, to) => {
    const filter = {};
    if (from) filter.$gte = new Date(from);
    if (to) {
        const end = new Date(to);
        if (!Number.isNaN(end.getTime())) {
            end.setHours(23, 59, 59, 999);
            filter.$lte = end;
        }
    }
    return Object.keys(filter).length ? filter : null;
};

const inRange = (ts, dateFilter) => {
    if (!dateFilter) return true;
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) return false;
    if (dateFilter.$gte && t < dateFilter.$gte.getTime()) return false;
    if (dateFilter.$lte && t > dateFilter.$lte.getTime()) return false;
    return true;
};

const touchFilter = (dateFilter) => {
    if (!dateFilter) return {};
    return {
        $or: [{ createdAt: dateFilter }, { updatedAt: dateFilter }],
    };
};

const eventBase = ({
    source_key,
    ts,
    category,
    type,
    title,
    details = '',
    tag,
    customer_id,
    case_id,
    case_label = '',
    case_code = '',
    appointment_id = null,
    session_id = null,
    actor_role = '',
    actor_name = '',
}) => ({
    id: source_key,
    source_key,
    ts: ts ? new Date(ts).toISOString() : new Date().toISOString(),
    category,
    type,
    tag: tag || TAG_FOR_CATEGORY[category] || 'SONSTIGES',
    title,
    details,
    customer_id: customer_id ? String(customer_id) : null,
    case_id: case_id ? String(case_id) : null,
    case_label,
    case_code,
    appointment_id: appointment_id ? String(appointment_id) : null,
    session_id: session_id ? String(session_id) : null,
    actor_role,
    actor_name,
});

const pushIf = (events, dateFilter, entry) => {
    if (!entry || !inRange(entry.ts, dateFilter)) return;
    events.push(entry);
};

const collectAppointments = async (scope, dateFilter) => {
    const filter = { ...scope, ...touchFilter(dateFilter) };
    const rows = await Appointment.find(filter)
        .select('case customer date time type status consultationOnly createdAt updatedAt')
        .sort({ updatedAt: -1 })
        .limit(FETCH_CAP)
        .lean();

    const events = [];
    for (const row of rows) {
        const kind = row.consultationOnly || row.type === APPOINTMENT_TYPE.BERATUNG ? 'Beratung' : 'Termin';
        const stamp = formatApptStamp(row.date, row.time);
        const isCancelled =
            row.status === APPOINTMENT_STATUS.STORNIERT ||
            row.status === APPOINTMENT_STATUS.CANCELLED;

        pushIf(
            events,
            dateFilter,
            eventBase({
                source_key: `appointment:${row._id}:booked`,
                ts: row.createdAt,
                category: ACTIVITY_CATEGORY.BOOKINGS,
                type: 'booked',
                title: `${kind} gebucht: ${stamp}`,
                customer_id: row.customer,
                case_id: row.case,
                appointment_id: row._id,
            })
        );

        if (isCancelled) {
            pushIf(
                events,
                dateFilter,
                eventBase({
                    source_key: `appointment:${row._id}:cancelled`,
                    ts: row.updatedAt || row.createdAt,
                    category: ACTIVITY_CATEGORY.CANCELLATIONS,
                    type: 'cancelled',
                    title: `${kind} storniert: ${stamp}`,
                    customer_id: row.customer,
                    case_id: row.case,
                    appointment_id: row._id,
                })
            );
        }
    }
    return events;
};

const collectSessions = async (scope, dateFilter) => {
    const filter = { ...scope };
    if (dateFilter) {
        filter.$or = [{ createdAt: dateFilter }, { treatment_date: dateFilter }, { updatedAt: dateFilter }];
    }

    const rows = await Session.find(filter)
        .select('case customer session_number is_no_show is_draft treatment_date treatment_time createdAt updatedAt')
        .sort({ createdAt: -1 })
        .limit(FETCH_CAP)
        .lean();

    const events = [];
    for (const row of rows) {
        if (row.is_draft) continue;
        if (row.is_no_show) {
            pushIf(
                events,
                dateFilter,
                eventBase({
                    source_key: `session:${row._id}:no_show`,
                    ts: row.updatedAt || row.createdAt,
                    category: ACTIVITY_CATEGORY.NO_SHOWS,
                    type: 'no_show',
                    title: `Nicht erschienen${row.treatment_date ? `: ${formatApptStamp(row.treatment_date, row.treatment_time)}` : ''}`,
                    customer_id: row.customer,
                    case_id: row.case,
                    session_id: row._id,
                    actor_role: 'studio',
                })
            );
            continue;
        }

        pushIf(
            events,
            dateFilter,
            eventBase({
                source_key: `session:${row._id}:session`,
                ts: row.createdAt,
                category: ACTIVITY_CATEGORY.SESSIONS,
                type: 'session_update',
                title: `Sitzung ${row.session_number ?? ''} dokumentiert${
                    row.treatment_date ? `: ${formatApptStamp(row.treatment_date, row.treatment_time)}` : ''
                }`.replace(/\s+/g, ' ').trim(),
                customer_id: row.customer,
                case_id: row.case,
                session_id: row._id,
                actor_role: 'studio',
            })
        );
    }
    return events;
};

const collectCases = async (scope, dateFilter) => {
    const filter = { ...scope };
    if (dateFilter) {
        filter.$or = [
            { createdAt: dateFilter },
            { updatedAt: dateFilter },
            { 'activityLog.ts': dateFilter },
        ];
    }

    const rows = await Case.find(filter)
        .select(
            'customer bodyLabel tc_title caseId activityLog createdAt uvBlockDate medicationBlockDate'
        )
        .sort({ updatedAt: -1 })
        .limit(FETCH_CAP)
        .lean();

    const events = [];
    for (const row of rows) {
        const label = caseLabel(row);
        pushIf(
            events,
            dateFilter,
            eventBase({
                source_key: `case:${row._id}:created`,
                ts: row.createdAt,
                category: ACTIVITY_CATEGORY.STUDIO,
                type: 'case_created',
                title: `Fall angelegt${label ? `: ${label}` : ''}`,
                customer_id: row.customer,
                case_id: row._id,
                case_label: label,
                case_code: row.caseId || '',
                actor_role: 'studio',
            })
        );

        for (const entry of row.activityLog || []) {
            const mapped = CASE_ACTIVITY_TYPE_MAP[entry.type];
            if (!mapped) continue;
            const title =
                entry.type === 'rescheduled'
                    ? `Termin neu angesetzt${entry.details ? `: ${entry.details}` : ''}`
                    : entry.details || mapped.type;
            pushIf(
                events,
                dateFilter,
                eventBase({
                    source_key: `case:${row._id}:activity:${entry._id || `${entry.type}:${entry.ts}`}`,
                    ts: entry.ts,
                    category: mapped.category,
                    type: mapped.type,
                    tag: mapped.tag,
                    title,
                    details: entry.details || '',
                    customer_id: row.customer,
                    case_id: row._id,
                    case_label: label,
                    case_code: row.caseId || '',
                })
            );
        }
    }
    return { events, cases: rows };
};

const collectAnamnesis = async (cases, dateFilter) => {
    if (!cases.length) return [];
    const ids = cases.map((c) => c._id);
    const rows = await Anamnesis.find({ case: { $in: ids } })
        .select('case audit_log')
        .lean();

    const caseById = new Map(cases.map((c) => [String(c._id), c]));
    const events = [];

    for (const row of rows) {
        const caseDoc = caseById.get(String(row.case));
        for (const [index, entry] of (row.audit_log || []).entries()) {
            if (entry.typ === 'klaerung_update') continue;
            const submitted = entry.typ === 'anamnesis_submitted';
            pushIf(
                events,
                dateFilter,
                eventBase({
                    source_key: `anamnesis:${row._id}:audit:${index}`,
                    ts: entry.zeitstempel,
                    category: ACTIVITY_CATEGORY.MEDICAL,
                    type: submitted ? 'anamnesis_submitted' : 'medical_change',
                    title: entry.details || (submitted ? 'Anamnese eingereicht' : 'Anamnese aktualisiert'),
                    details: entry.bearbeitet_von ? `Bearbeitet von ${entry.bearbeitet_von}` : '',
                    customer_id: caseDoc?.customer,
                    case_id: row.case,
                    case_label: caseLabel(caseDoc),
                    case_code: caseDoc?.caseId || '',
                    actor_name: entry.bearbeitet_von || '',
                })
            );
        }
    }
    return events;
};

const collectCrmNotes = async (scope, dateFilter) => {
    const filter = { ...scope };
    if (dateFilter) filter.createdAt = dateFilter;

    const rows = await CrmNote.find(filter)
        .select('customer typ inhalt createdAt')
        .sort({ createdAt: -1 })
        .limit(FETCH_CAP)
        .lean();

    return rows.flatMap((row) => {
        const snippet = (row.inhalt || '').trim().slice(0, 140);
        const entry = eventBase({
            source_key: `crmnote:${row._id}`,
            ts: row.createdAt,
            category: ACTIVITY_CATEGORY.STUDIO,
            type: 'studio_action',
            title: `CRM-Notiz (${row.typ || 'notiz'})`,
            details: snippet,
            customer_id: row.customer,
            actor_role: 'studio',
        });
        return inRange(entry.ts, dateFilter) ? [entry] : [];
    });
};

const collectNachsorge = async (scope, dateFilter) => {
    const filter = { ...scope };
    if (dateFilter) filter.createdAt = dateFilter;

    const rows = await NachsorgeCheck.find(filter)
        .select('customer case titel ampel createdAt')
        .sort({ createdAt: -1 })
        .limit(FETCH_CAP)
        .lean();

    return rows.flatMap((row) => {
        const ampel = row.ampel ? ` · ${row.ampel}` : '';
        const entry = eventBase({
            source_key: `nachsorge:${row._id}`,
            ts: row.createdAt,
            category: ACTIVITY_CATEGORY.MEDICAL,
            type: 'aftercare',
            title: `Nachsorge-Check${row.titel ? `: ${row.titel}` : ''}${ampel}`,
            customer_id: row.customer,
            case_id: row.case,
            actor_role: 'customer',
        });
        return inRange(entry.ts, dateFilter) ? [entry] : [];
    });
};

const collectCustomers = async (scope, dateFilter) => {
    const filter = scope.customer
        ? { _id: scope.customer }
        : { aktuelle_firma_id: scope.studio };
    if (!scope.customer && dateFilter) {
        filter.createdAt = dateFilter;
    }

    const rows = await Customer.find(filter)
        .select('vorname nachname createdAt firma_history')
        .sort({ createdAt: -1 })
        .limit(scope.customer ? 1 : FETCH_CAP)
        .lean();

    const events = [];
    for (const row of rows) {
        pushIf(
            events,
            dateFilter,
            eventBase({
                source_key: `customer:${row._id}:created`,
                ts: row.createdAt,
                category: ACTIVITY_CATEGORY.PROFILE,
                type: 'profile_created',
                title: 'Kundenprofil angelegt',
                customer_id: row._id,
                actor_role: 'studio',
            })
        );

        for (const [index, entry] of (row.firma_history || []).entries()) {
            pushIf(
                events,
                dateFilter,
                eventBase({
                    source_key: `customer:${row._id}:firma:${index}`,
                    ts: entry.von,
                    category: ACTIVITY_CATEGORY.PROFILE,
                    type: 'studio_assignment',
                    title: `Studio-Zuordnung${entry.grund ? `: ${String(entry.grund).replace(/_/g, ' ')}` : ''}`,
                    customer_id: row._id,
                })
            );
        }
    }
    return events;
};

const collectStoredEvents = async (scope, dateFilter) => {
    const filter = { ...scope };
    if (dateFilter) filter.ts = dateFilter;

    const rows = await ActivityEvent.find(filter)
        .sort({ ts: -1 })
        .limit(FETCH_CAP)
        .lean();

    return rows.map((row) =>
        eventBase({
            source_key: row.source_key,
            ts: row.ts,
            category: row.category,
            type: row.type,
            tag: row.tag,
            title: row.title,
            details: row.details,
            customer_id: row.customer,
            case_id: row.case,
            appointment_id: row.appointment,
            session_id: row.session,
            actor_role: row.actor_role,
            actor_name: row.actor_name,
        })
    );
};

const attachLookups = (events, cases, customers) => {
    const caseById = new Map(cases.map((c) => [String(c._id), c]));
    const customerById = new Map(customers.map((c) => [String(c._id), c]));

    return events.map((event) => {
        const caseDoc = event.case_id ? caseById.get(event.case_id) : null;
        const customer = event.customer_id ? customerById.get(event.customer_id) : null;
        return {
            ...event,
            case_label: event.case_label || caseLabel(caseDoc),
            case_code: event.case_code || caseDoc?.caseId || '',
            customer_name: customer
                ? `${customer.vorname ?? ''} ${customer.nachname ?? ''}`.trim()
                : '',
        };
    });
};

const studioScope = (studioId, customerId, includeAllCustomerStudios) => {
    if (customerId && includeAllCustomerStudios) {
        return { customer: customerId };
    }
    const scope = { studio: studioId };
    if (customerId) scope.customer = customerId;
    return scope;
};

const composeActivityFeed = async ({
    studioId,
    customerId,
    includeAllCustomerStudios = false,
    category,
    from,
    to,
    page,
    limit,
}) => {
    const dateFilter = buildDateFilter(from, to);
    const scope = studioScope(studioId, customerId, includeAllCustomerStudios);

    const [stored, appointments, sessions, casePack, crmNotes, nachsorge, customerEvents] =
        await Promise.all([
            collectStoredEvents(scope, dateFilter),
            collectAppointments(scope, dateFilter),
            collectSessions(scope, dateFilter),
            collectCases(scope, dateFilter),
            collectCrmNotes(scope, dateFilter),
            collectNachsorge(scope, dateFilter),
            collectCustomers(scope, dateFilter),
        ]);

    const anamnesisEvents = await collectAnamnesis(casePack.cases, dateFilter);

    const merged = [];
    const seen = new Set();
    for (const entry of [
        ...stored,
        ...appointments,
        ...sessions,
        ...casePack.events,
        ...anamnesisEvents,
        ...crmNotes,
        ...nachsorge,
        ...customerEvents,
    ]) {
        if (!entry?.source_key || seen.has(entry.source_key)) continue;
        seen.add(entry.source_key);
        if (category && category !== 'all' && entry.category !== category) continue;
        merged.push(entry);
    }

    merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    const customerIds = [...new Set(merged.map((e) => e.customer_id).filter(Boolean))];
    const customers = customerIds.length
        ? await Customer.find({ _id: { $in: customerIds } })
              .select('vorname nachname')
              .lean()
        : [];

    const hydrated = attachLookups(merged, casePack.cases, customers);
    const total = hydrated.length;
    const start = (page - 1) * limit;
    const items = hydrated.slice(start, start + limit);

    return { items, total };
};

module.exports = {
    composeActivityFeed,
    buildDateFilter,
};

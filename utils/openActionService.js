const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const NachsorgeCheck = require('../models/nachsorgeCheckModel');
const Studio = require('../models/studioModel');
const User = require('../models/userModel');
const OpenActionNotice = require('../models/openActionNoticeModel');
const { createForUsers } = require('../services/notificationService');
const { sendToUsers } = require('../services/pushService');
const {
    CASE_STATUS,
    ESTIMATE_CONFIRMATION_STATUS,
    STUDIO_FREIGABE_STATUS,
    MEDICAL_FLAG_LEVEL,
    APPOINTMENT_STATUS,
    USER_ROLES,
    USER_STATUS,
} = require('../config/constants');

const ACTION_TYPES = {
    CONFIRM_PRICE: 'confirm_price',
    REVIEW_MEDICAL: 'review_medical',
    REVIEW_CASE: 'review_case',
    REVIEW_AFTERCARE: 'review_aftercare',
    HEALING_ISSUE: 'healing_issue',
    FOLLOWUP_CANCELLATION: 'followup_cancellation',
    WAITING_APPOINTMENT: 'waiting_appointment',
};

const PRIORITY = {
    HIGH: 'hoch',
    MEDIUM: 'mittel',
    LOW: 'niedrig',
};

const TYPE_LABEL_DE = {
    confirm_price: 'Preis bestätigen',
    review_medical: 'Medizinische Angaben prüfen',
    review_case: 'Neuen Fall prüfen',
    review_aftercare: 'Nachsorgefoto prüfen',
    healing_issue: 'Heilung braucht Aufmerksamkeit',
    followup_cancellation: 'Nachfassen nach Absage',
    waiting_appointment: 'Kunde wartet auf einen Termin',
};

const ESCALATE_AFTER_HOURS = 48;
const RAISE_PRIORITY_AFTER_HOURS = 72;
const CANCELLATION_WINDOW_DAYS = 21;
const BATCH_NOTIFY_LIMIT = 12;

const PRIORITY_RANK = { hoch: 0, mittel: 1, niedrig: 2 };

const hoursSince = (date) => {
    const ts = new Date(date).getTime();
    if (!Number.isFinite(ts)) return 0;
    return Math.max(0, Math.round((Date.now() - ts) / 36e5));
};

const customerName = (customer) => {
    if (!customer || typeof customer !== 'object') return 'Kunde';
    const name = `${customer.vorname || ''} ${customer.nachname || ''}`.trim();
    return name || 'Kunde';
};

const customerIdOf = (customer) => {
    if (!customer) return null;
    if (typeof customer === 'object' && customer._id) return String(customer._id);
    return String(customer);
};

const applyAgePriority = (priority, ageHours) => {
    if (ageHours >= RAISE_PRIORITY_AFTER_HOURS && priority !== PRIORITY.HIGH) {
        return PRIORITY.HIGH;
    }
    return priority;
};

const pushAction = (list, action) => {
    const ageHours = hoursSince(action.opened_at);
    list.push({
        ...action,
        age_hours: ageHours,
        priority: applyAgePriority(action.priority, ageHours),
        escalated: ageHours >= ESCALATE_AFTER_HOURS,
    });
};

const collectActions = async ({ studioId = null } = {}) => {
    const studioFilter = studioId ? { studio: studioId } : {};
    const actions = [];

    const cases = await Case.find({
        ...studioFilter,
        status: { $in: [CASE_STATUS.PENDING, CASE_STATUS.ACTIVE] },
    })
        .select(
            'caseId customer studio status createdAt estimate_confirmation estimate_needs_review studio_freigabe medical_flag_level'
        )
        .populate('customer', 'vorname nachname')
        .limit(studioId ? 500 : 800)
        .lean();

    const futureAppointments = await Appointment.find({
        ...studioFilter,
        status: APPOINTMENT_STATUS.GEBUCHT,
        date: { $gte: new Date() },
    })
        .select('customer')
        .lean();
    const customersWithFutureVisit = new Set(
        futureAppointments.map((row) => customerIdOf(row.customer)).filter(Boolean)
    );

    for (const caseDoc of cases) {
        const cid = customerIdOf(caseDoc.customer);
        const base = {
            studio_id: String(caseDoc.studio),
            customer_id: cid,
            customer_name: customerName(caseDoc.customer),
            case_id: String(caseDoc._id),
            case_ref: caseDoc.caseId || '',
            opened_at: caseDoc.createdAt,
            path: `/studio/cases/${caseDoc._id}?focus=estimate`,
        };
        const confirmStatus =
            caseDoc.estimate_confirmation?.status || ESTIMATE_CONFIRMATION_STATUS.OFFEN;
        const priceOpen =
            caseDoc.status === CASE_STATUS.PENDING &&
            confirmStatus === ESTIMATE_CONFIRMATION_STATUS.OFFEN;

        if (priceOpen) {
            pushAction(actions, {
                ...base,
                key: `confirm_price:${caseDoc._id}`,
                type: ACTION_TYPES.CONFIRM_PRICE,
                priority: caseDoc.estimate_needs_review ? PRIORITY.HIGH : PRIORITY.MEDIUM,
            });
        } else if (
            caseDoc.status === CASE_STATUS.PENDING &&
            caseDoc.estimate_needs_review
        ) {
            pushAction(actions, {
                ...base,
                key: `review_case:${caseDoc._id}`,
                type: ACTION_TYPES.REVIEW_CASE,
                priority: PRIORITY.HIGH,
            });
        }

        const freigabe = caseDoc.studio_freigabe || {};
        const medicalWaiting =
            freigabe.erforderlich === true &&
            freigabe.status === STUDIO_FREIGABE_STATUS.AUSSTEHEND;
        const flagNeedsEyes =
            (caseDoc.medical_flag_level === MEDICAL_FLAG_LEVEL.ROT ||
                caseDoc.medical_flag_level === MEDICAL_FLAG_LEVEL.ORANGE) &&
            freigabe.status !== STUDIO_FREIGABE_STATUS.FREIGEGEBEN;
        if (medicalWaiting || flagNeedsEyes) {
            pushAction(actions, {
                ...base,
                key: `review_medical:${caseDoc._id}`,
                type: ACTION_TYPES.REVIEW_MEDICAL,
                priority:
                    caseDoc.medical_flag_level === MEDICAL_FLAG_LEVEL.ROT
                        ? PRIORITY.HIGH
                        : PRIORITY.MEDIUM,
                path: cid
                    ? `/studio/customers/${cid}?focus=medical_clearance`
                    : base.path,
            });
        }

    }

    const checks = await NachsorgeCheck.find({
        ...studioFilter,
        healing_studio_reviewed_at: null,
        $or: [
            { healing_needs_review: true },
            { healing_red_flag: true },
            { studio_kontakt: true },
            { ampel: { $in: [MEDICAL_FLAG_LEVEL.ORANGE, MEDICAL_FLAG_LEVEL.ROT] } },
            { foto_status: { $in: [MEDICAL_FLAG_LEVEL.ORANGE, MEDICAL_FLAG_LEVEL.ROT] } },
        ],
    })
        .select(
            'customer case studio createdAt healing_red_flag healing_needs_review ampel foto_status studio_kontakt studio_review_notes healing_studio_reviewed_at'
        )
        .populate('customer', 'vorname nachname')
        .populate('case', 'caseId')
        .sort({ createdAt: -1 })
        .limit(300)
        .lean();

    for (const check of checks) {
        if (String(check.studio_review_notes || '').trim()) continue;
        const red =
            check.healing_red_flag === true ||
            check.ampel === MEDICAL_FLAG_LEVEL.ROT ||
            check.foto_status === MEDICAL_FLAG_LEVEL.ROT;
        const cid = customerIdOf(check.customer);
        pushAction(actions, {
            key: `${red ? 'healing_issue' : 'review_aftercare'}:${check._id}`,
            type: red ? ACTION_TYPES.HEALING_ISSUE : ACTION_TYPES.REVIEW_AFTERCARE,
            priority: red ? PRIORITY.HIGH : PRIORITY.MEDIUM,
            studio_id: String(check.studio),
            customer_id: cid,
            customer_name: customerName(check.customer),
            case_id: check.case?._id ? String(check.case._id) : check.case ? String(check.case) : null,
            case_ref: check.case?.caseId || '',
            opened_at: check.createdAt,
            path: `/studio/aftercare?check=${check._id}`,
        });
    }

    const since = new Date(Date.now() - CANCELLATION_WINDOW_DAYS * 864e5);
    const cancelled = await Appointment.find({
        ...studioFilter,
        status: { $in: [APPOINTMENT_STATUS.STORNIERT, APPOINTMENT_STATUS.CANCELLED] },
        updatedAt: { $gte: since },
    })
        .select('customer case studio date updatedAt')
        .populate('customer', 'vorname nachname')
        .populate('case', 'caseId')
        .sort({ updatedAt: -1 })
        .limit(300)
        .lean();

    const seenCancellationCustomers = new Set();
    for (const appt of cancelled) {
        const cid = customerIdOf(appt.customer);
        if (!cid || customersWithFutureVisit.has(cid) || seenCancellationCustomers.has(cid)) {
            continue;
        }
        seenCancellationCustomers.add(cid);
        pushAction(actions, {
            key: `followup_cancellation:${cid}`,
            type: ACTION_TYPES.FOLLOWUP_CANCELLATION,
            priority: PRIORITY.MEDIUM,
            studio_id: String(appt.studio),
            customer_id: cid,
            customer_name: customerName(appt.customer),
            case_id: appt.case?._id ? String(appt.case._id) : appt.case ? String(appt.case) : null,
            case_ref: appt.case?.caseId || '',
            opened_at: appt.updatedAt || appt.date,
            path: `/studio/appointments?book=1&customer_id=${cid}${
                appt.case?._id ? `&case_id=${appt.case._id}` : ''
            }`,
        });
    }

    const followupCustomers = new Set(
        actions
            .filter((row) => row.type === ACTION_TYPES.FOLLOWUP_CANCELLATION)
            .map((row) => row.customer_id)
            .filter(Boolean)
    );
    const withoutDuplicateWait = actions.filter(
        (row) =>
            row.type !== ACTION_TYPES.WAITING_APPOINTMENT ||
            !followupCustomers.has(row.customer_id)
    );

    const studioIds = [...new Set(withoutDuplicateWait.map((row) => row.studio_id))];
    const studios = studioIds.length
        ? await Studio.find({ _id: { $in: studioIds } }).select('firma').lean()
        : [];
    const studioNames = new Map(studios.map((row) => [String(row._id), row.firma || 'Studio']));

    return withoutDuplicateWait
        .map((row) => ({
            ...row,
            studio_name: studioNames.get(row.studio_id) || 'Studio',
            opened_at: row.opened_at ? new Date(row.opened_at).toISOString() : null,
        }))
        .sort(
            (a, b) =>
                (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) ||
                b.age_hours - a.age_hours
        );
};

const summarize = (actions) => {
    const byType = {};
    for (const row of actions) {
        byType[row.type] = (byType[row.type] || 0) + 1;
    }
    return {
        open: actions.length,
        urgent: actions.filter((row) => row.priority === PRIORITY.HIGH).length,
        by_type: byType,
    };
};

const emitNotice = (rooms, notification) => {
    try {
        const { getIO } = require('../sockets/io');
        const io = getIO();
        if (!io) return;
        const envelope = { notification };
        for (const room of rooms) {
            if (room) io.to(room).emit('notification:created', envelope);
        }
    } catch (err) {
        console.error('Open action socket fan-out failed:', err.message);
    }
};

const deliverNotice = async ({ userIds, studioId, title, body, meta, rooms }) => {
    if (!userIds.length) return;
    let created = [];
    try {
        created = await createForUsers({
            userIds,
            type: 'open_action',
            title,
            body,
            studioId,
            caseId: meta.case_id || null,
            meta,
        });
    } catch (err) {
        console.error('Open action inbox failed:', err.message);
    }
    const notification = created[0] || {
        type: 'open_action',
        title,
        body,
        meta,
        studio_id: studioId ? String(studioId) : null,
        unread: true,
    };
    emitNotice(rooms, notification);
    try {
        await sendToUsers(userIds, {
            title,
            body,
            data: {
                type: 'open_action',
                path: meta.path || '',
                action_key: meta.action_key || '',
            },
        });
    } catch (err) {
        console.error('Open action push failed:', err.message);
    }
};

const announceActions = async (studioId, actions) => {
    const keys = actions.map((row) => row.key);
    const existing = await OpenActionNotice.find({ studio: studioId }).select('action_key escalated_at').lean();
    const known = new Map(existing.map((row) => [row.action_key, row]));

    await OpenActionNotice.deleteMany({
        studio: studioId,
        ...(keys.length ? { action_key: { $nin: keys } } : {}),
    });

    const fresh = [];
    for (const action of actions) {
        if (known.has(action.key)) continue;
        try {
            await OpenActionNotice.create({
                studio: studioId,
                action_key: action.key,
                escalated_at: action.age_hours >= ESCALATE_AFTER_HOURS ? new Date() : null,
            });
            fresh.push(action);
        } catch (err) {
            if (err.code !== 11000) console.error('Open action notice failed:', err.message);
        }
    }

    const toEscalate = [];
    for (const action of actions) {
        const notice = known.get(action.key);
        if (!notice || notice.escalated_at || action.age_hours < ESCALATE_AFTER_HOURS) continue;
        await OpenActionNotice.updateOne(
            { _id: notice._id },
            { escalated_at: new Date() }
        );
        toEscalate.push(action);
    }

    if (!fresh.length && !toEscalate.length) return;

    const staff = await User.find({
        studio_id: studioId,
        role: { $in: [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF] },
        status: USER_STATUS.AKTIV,
    })
        .select('_id')
        .lean();
    const staffIds = staff.map((row) => row._id);
    const admins = await User.find({
        role: { $in: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
        status: USER_STATUS.AKTIV,
    })
        .select('_id')
        .lean();
    const adminIds = admins.map((row) => row._id);

    let studioRoom = null;
    let adminRoom = null;
    try {
        const messagingService = require('../services/messagingService');
        const platformMessagingService = require('../services/platformMessagingService');
        studioRoom = messagingService.studioRoom(String(studioId));
        adminRoom = platformMessagingService.adminRoom();
    } catch (err) {
        console.error('Open action rooms failed:', err.message);
    }

    const sendOne = async (action, reminder) => {
        const label = TYPE_LABEL_DE[action.type] || 'Aufgabe';
        const title = reminder ? `Noch offen: ${label}` : label;
        const body = `${action.customer_name}${action.case_ref ? ` · ${action.case_ref}` : ''}`;
        const meta = {
            path: action.path,
            action_key: action.key,
            customer_id: action.customer_id,
            case_id: action.case_id,
            screen: 'open_actions',
        };
        await deliverNotice({
            userIds: staffIds,
            studioId,
            title,
            body,
            meta,
            rooms: [studioRoom],
        });
        const tellAdmin = reminder || action.priority === PRIORITY.HIGH;
        if (tellAdmin) {
            await deliverNotice({
                userIds: adminIds,
                studioId,
                title,
                body: `${body} · ${action.studio_name}`,
                meta: { ...meta, path: '/admin/actions' },
                rooms: [adminRoom],
            });
        }
    };

    const sendBatch = async (rows, reminder) => {
        if (!rows.length) return;
        if (rows.length > BATCH_NOTIFY_LIMIT) {
            const title = reminder ? 'Offene Aufgaben noch nicht erledigt' : 'Offene Aufgaben';
            const body = `${rows.length} Aufgaben brauchen eine Antwort vom Studio.`;
            await deliverNotice({
                userIds: staffIds,
                studioId,
                title,
                body,
                meta: { path: '/studio/actions', screen: 'open_actions' },
                rooms: [studioRoom],
            });
            const adminRows = rows.filter((row) => reminder || row.priority === PRIORITY.HIGH);
            if (adminRows.length) {
                await deliverNotice({
                    userIds: adminIds,
                    studioId,
                    title,
                    body: `${adminRows.length} Aufgaben bei ${rows[0].studio_name} brauchen Aufmerksamkeit.`,
                    meta: { path: '/admin/actions', screen: 'open_actions' },
                    rooms: [adminRoom],
                });
            }
            return;
        }
        for (const action of rows) {
            await sendOne(action, reminder);
        }
    };

    await sendBatch(fresh, false);
    await sendBatch(toEscalate, true);
};

const listOpenActions = async ({
    studioId = null,
    notify = false,
    type = null,
    priority = null,
    minAgeHours = 0,
} = {}) => {
    let actions = await collectActions({ studioId });
    if (notify && studioId) {
        try {
            await announceActions(studioId, actions);
        } catch (err) {
            console.error('Open action notify failed:', err.message);
        }
    }
    if (type) actions = actions.filter((row) => row.type === type);
    if (priority) actions = actions.filter((row) => row.priority === priority);
    const minAge = Number(minAgeHours) || 0;
    if (minAge > 0) actions = actions.filter((row) => row.age_hours >= minAge);
    return { actions, summary: summarize(actions) };
};

const agePhrase = (hours) => {
    if (hours < 1) return 'weniger als 1 Stunde';
    if (hours < 24) return hours === 1 ? '1 Stunde' : `${hours} Stunden`;
    const days = Math.round(hours / 24);
    return days === 1 ? '1 Tag' : `${days} Tage`;
};

const formatOpenActionsForChat = async (studioId) => {
    const { actions, summary } = await listOpenActions({ studioId, notify: false });
    if (!summary.open) {
        return 'OFFENE AUFGABEN: keine. Es wartet gerade keine Studio-Aktion.';
    }
    const lines = actions.slice(0, 12).map((row) => {
        const label = TYPE_LABEL_DE[row.type] || row.type;
        const caseBit = row.case_ref ? ` → Fall ${row.case_ref}` : '';
        return `- ${row.customer_name}${caseBit} → ${label} → Priorität ${row.priority} → offen seit ${agePhrase(row.age_hours)}`;
    });
    const parts = Object.entries(summary.by_type)
        .map(([type, count]) => `${count} ${TYPE_LABEL_DE[type] || type}`)
        .join(', ');
    return [
        'OFFENE AUFGABEN (bleiben offen, bis die Aktion im System erledigt ist, nicht nach einer Benachrichtigung):',
        ...lines,
        summary.open > 12 ? `- … und ${summary.open - 12} weitere` : '',
        `Aktuell ${summary.open} offene Aufgabe(n)${summary.urgent ? `, davon ${summary.urgent} dringend` : ''}: ${parts}.`,
        'Wenn das Studio nach offenen Aufgaben, Erinnerungen oder einem bestimmten Kunden fragt, nenne diese Punkte. Eine Aufgabe gilt erst als erledigt, wenn die zugehörige Aktion abgeschlossen ist.',
    ]
        .filter(Boolean)
        .join('\n');
};

/** Tell open studio and admin screens to reload the queue after a task is finished. */
const publishOpenActionsChanged = (studioId) => {
    if (!studioId) return;
    const id = String(studioId);
    setImmediate(async () => {
        try {
            const { summary } = await listOpenActions({ studioId: id, notify: false });
            const { getIO } = require('../sockets/io');
            const io = getIO();
            if (!io) return;
            const payload = {
                studio_id: id,
                open: summary.open,
                urgent: summary.urgent,
            };
            io.to(`studio:${id}`).emit('open_actions:changed', payload);
            io.to('platform:admins').emit('open_actions:changed', payload);
        } catch (err) {
            console.error('Open actions refresh failed:', err.message);
        }
    });
};

module.exports = {
    ACTION_TYPES,
    listOpenActions,
    formatOpenActionsForChat,
    publishOpenActionsChanged,
};

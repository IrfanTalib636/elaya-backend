const crypto = require('crypto');
const Appointment = require('../models/appointmentModel');
const Case = require('../models/caseModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertBookingDateAllowed } = require('../utils/lockoutEngine');
const { applyKurzfristigeStornierungMalusIfNeeded } = require('../utils/elaycoinEngine');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { syncCustomerPipeline } = require('../utils/pipelineEngine');
const {
    USER_ROLES,
    APPOINTMENT_TYPE,
    APPOINTMENT_STATUS,
} = require('../config/constants');

const STUDIO_ROLES = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

const MONTHS_DE = [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
];

const isCustomer = (role) => role === USER_ROLES.CUSTOMER;
const isStudio = (role) => STUDIO_ROLES.includes(role);
const isAdmin = (role) => ADMIN_ROLES.includes(role);

const formatMonthDe = (date) => `${MONTHS_DE[date.getMonth()]} ${date.getFullYear()}`;

const formatAppointment = (doc) => {
    const a = doc.toObject ? doc.toObject() : doc;
    return {
        id: a._id,
        case: a.case,
        customer: a.customer,
        studio: a.studio,
        day: a.day,
        month: a.month,
        time: a.time,
        date: a.date,
        status: a.status,
        type: a.type,
        consultationOnly: a.consultationOnly,
        dauer_minuten: a.dauer_minuten,
        standort_id: a.standort_id,
        standort_name: a.standort_name,
        gruppen_termin: a.gruppen_termin,
        gruppen_id: a.gruppen_id,
        gruppen_cases: a.gruppen_cases,
        gruppen_rabatt: a.gruppen_rabatt,
        gruppen_preis_total: a.gruppen_preis_total,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
    };
};

const assertCaseAccess = (user, caseDoc) => {
    if (isAdmin(user.role)) {
        return;
    }

    if (isCustomer(user.role)) {
        if (caseDoc.customer.toString() !== user.customer_id.toString()) {
            throw new ApiError(403, 'You do not have access to this case');
        }
        return;
    }

    if (isStudio(user.role)) {
        if (caseDoc.studio.toString() !== user.studio_id.toString()) {
            throw new ApiError(403, 'You do not have access to this case');
        }
        return;
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const assertAppointmentAccess = (user, appointment) => {
    if (isAdmin(user.role)) {
        return;
    }

    if (isCustomer(user.role)) {
        if (appointment.customer.toString() !== user.customer_id.toString()) {
            throw new ApiError(403, 'You do not have access to this appointment');
        }
        return;
    }

    if (isStudio(user.role)) {
        if (appointment.studio.toString() !== user.studio_id.toString()) {
            throw new ApiError(403, 'You do not have access to this appointment');
        }
        return;
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const resolveAppointmentType = (consultationOnly, type) => {
    if (consultationOnly) {
        return APPOINTMENT_TYPE.BERATUNG;
    }
    return type || APPOINTMENT_TYPE.TREATMENT;
};

const buildAppointmentPayload = (caseDoc, body, gruppenMeta = {}) => {
    const date = new Date(body.date);
    const consultationOnly = body.consultationOnly ?? false;

    return {
        case: caseDoc._id,
        customer: caseDoc.customer,
        studio: caseDoc.studio,
        day: date.getDate(),
        month: formatMonthDe(date),
        time: body.time,
        date,
        type: resolveAppointmentType(consultationOnly, body.type),
        consultationOnly,
        dauer_minuten: body.dauer_minuten ?? null,
        standort_id: body.standort_id ?? '',
        standort_name: body.standort_name ?? '',
        gruppen_termin: gruppenMeta.gruppen_termin ?? false,
        gruppen_id: gruppenMeta.gruppen_id ?? null,
        gruppen_cases: gruppenMeta.gruppen_cases ?? [],
        gruppen_rabatt: gruppenMeta.gruppen_rabatt ?? null,
        gruppen_preis_total: gruppenMeta.gruppen_preis_total ?? null,
    };
};

const appendCaseActivity = async (caseDoc, type, details) => {
    caseDoc.activityLog.push({ type, ts: new Date(), details });
    await caseDoc.save();
};

const loadCasesForGroup = async (primaryCase, gruppenCaseIds, user) => {
    const uniqueIds = [...new Set([primaryCase._id.toString(), ...gruppenCaseIds])];
    const cases = await Case.find({ _id: { $in: uniqueIds } });

    if (cases.length !== uniqueIds.length) {
        throw new ApiError(404, 'One or more group cases not found');
    }

    for (const caseDoc of cases) {
        assertCaseAccess(user, caseDoc);
        if (caseDoc.customer.toString() !== primaryCase.customer.toString()) {
            throw new ApiError(400, 'Group booking cases must belong to the same customer');
        }
    }

    return cases;
};

const createAppointment = asyncHandler(async (req, res) => {
    const { case_id, gruppen_cases, ...body } = req.body;

    const primaryCase = await Case.findById(case_id);
    if (!primaryCase) {
        throw new ApiError(404, 'Case not found');
    }

    assertCaseAccess(req.user, primaryCase);

    const isGroup = body.gruppen_termin && gruppen_cases.length > 0;
    const groupCases = isGroup
        ? await loadCasesForGroup(primaryCase, gruppen_cases, req.user)
        : [primaryCase];

    if (!body.consultationOnly && body.type !== APPOINTMENT_TYPE.BERATUNG) {
        const preSessionCheck = body.preSessionCheck ?? {};
        for (const caseDoc of groupCases) {
            await assertBookingDateAllowed({
                caseId: caseDoc._id,
                customerId: caseDoc.customer,
                date: body.date,
                consultationOnly: false,
                preSessionCheck,
            });
        }
    }

    const gruppen_id = isGroup ? crypto.randomUUID() : null;
    const gruppenCaseIds = groupCases.map((c) => c._id);

    const appointments = await Appointment.insertMany(
        groupCases.map((caseDoc) =>
            buildAppointmentPayload(caseDoc, body, {
                gruppen_termin: isGroup,
                gruppen_id,
                gruppen_cases: gruppenCaseIds,
                gruppen_rabatt: body.gruppen_rabatt,
                gruppen_preis_total: body.gruppen_preis_total,
            })
        )
    );

    for (const caseDoc of groupCases) {
        await appendCaseActivity(
            caseDoc,
            'booked',
            `${body.time} · ${formatMonthDe(new Date(body.date))}`
        );
        await syncCustomerPipeline(caseDoc.customer);
    }

    res.status(201).json({
        success: true,
        message: isGroup ? 'Group appointment booked successfully' : 'Appointment booked successfully',
        data: {
            appointments: appointments.map(formatAppointment),
        },
    });
});

const listAppointments = asyncHandler(async (req, res) => {
    const filter = {};

    if (isCustomer(req.user.role)) {
        filter.customer = req.user.customer_id;
    } else if (isStudio(req.user.role)) {
        filter.studio = req.user.studio_id;
    } else if (!isAdmin(req.user.role)) {
        throw new ApiError(403, 'You do not have permission to list appointments');
    }

    if (req.query.case_id) {
        filter.case = req.query.case_id;
    }
    if (req.query.customer_id && !isCustomer(req.user.role)) {
        filter.customer = req.query.customer_id;
    }
    if (req.query.studio_id && isAdmin(req.user.role)) {
        filter.studio = req.query.studio_id;
    }
    if (req.query.status) {
        filter.status = req.query.status;
    }
    if (req.query.from || req.query.to) {
        filter.date = {};
        if (req.query.from) {
            filter.date.$gte = new Date(req.query.from);
        }
        if (req.query.to) {
            filter.date.$lte = new Date(req.query.to);
        }
    }

    const { page, limit, skip } = parsePagination(req.query);

    const [appointments, total] = await Promise.all([
        Appointment.find(filter)
            .sort({ date: 1 })
            .skip(skip)
            .limit(limit)
            .populate('customer', 'vorname nachname email')
            .populate('case', 'caseId tc_title type')
            .lean(),
        Appointment.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            appointments: appointments.map(formatAppointment),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const getAppointment = asyncHandler(async (req, res) => {
    const appointment = await Appointment.findById(req.params.id)
        .populate('customer', 'vorname nachname email telefon')
        .populate('case', 'caseId tc_title type bodyLabel');

    if (!appointment) {
        throw new ApiError(404, 'Appointment not found');
    }

    assertAppointmentAccess(req.user, appointment);

    res.status(200).json({
        success: true,
        data: {
            appointment: formatAppointment(appointment),
        },
    });
});

const updateAppointment = asyncHandler(async (req, res) => {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
        throw new ApiError(404, 'Appointment not found');
    }

    assertAppointmentAccess(req.user, appointment);

    const consultationOnly = req.body.consultationOnly ?? appointment.consultationOnly;
    const isReschedule = req.body.date && !consultationOnly && appointment.type !== APPOINTMENT_TYPE.BERATUNG;

    if (isReschedule) {
        const caseDoc = await Case.findById(appointment.case);
        if (caseDoc) {
            await assertBookingDateAllowed({
                caseId: caseDoc._id,
                customerId: caseDoc.customer,
                date: req.body.date,
                consultationOnly: false,
                preSessionCheck: req.body.preSessionCheck ?? {},
            });
        }
    }

    const previousDate = appointment.date;
    const wasCancelled =
        appointment.status === APPOINTMENT_STATUS.STORNIERT ||
        appointment.status === APPOINTMENT_STATUS.CANCELLED;

    if (req.body.date) {
        const date = new Date(req.body.date);
        appointment.date = date;
        appointment.day = date.getDate();
        appointment.month = formatMonthDe(date);
    }

    if (req.body.time !== undefined) {
        appointment.time = req.body.time;
    }
    if (req.body.status !== undefined) {
        appointment.status = req.body.status;
    }
    if (req.body.type !== undefined) {
        appointment.type = req.body.type;
    }
    if (req.body.consultationOnly !== undefined) {
        appointment.consultationOnly = req.body.consultationOnly;
        if (req.body.consultationOnly) {
            appointment.type = APPOINTMENT_TYPE.BERATUNG;
        }
    }
    if (req.body.dauer_minuten !== undefined) {
        appointment.dauer_minuten = req.body.dauer_minuten;
    }
    if (req.body.standort_id !== undefined) {
        appointment.standort_id = req.body.standort_id;
    }
    if (req.body.standort_name !== undefined) {
        appointment.standort_name = req.body.standort_name;
    }
    if (req.body.gruppen_rabatt !== undefined) {
        appointment.gruppen_rabatt = req.body.gruppen_rabatt;
    }
    if (req.body.gruppen_preis_total !== undefined) {
        appointment.gruppen_preis_total = req.body.gruppen_preis_total;
    }

    await appointment.save();

    await syncCustomerPipeline(appointment.customer);

    const isNowCancelled =
        appointment.status === APPOINTMENT_STATUS.STORNIERT ||
        appointment.status === APPOINTMENT_STATUS.CANCELLED;
    const dateChanged =
        req.body.date && new Date(req.body.date).getTime() !== new Date(previousDate).getTime();

    if (!wasCancelled && (isNowCancelled || dateChanged)) {
        try {
            await applyKurzfristigeStornierungMalusIfNeeded({
                ...appointment.toObject(),
                date: previousDate,
            });
        } catch (err) {
            console.error('[ELAYCOIN] kurzfristige_stornierung:', err.message);
        }
    }

    const caseDoc = await Case.findById(appointment.case);
    if (caseDoc) {
        if (
            req.body.status === APPOINTMENT_STATUS.STORNIERT ||
            req.body.status === APPOINTMENT_STATUS.CANCELLED
        ) {
            await appendCaseActivity(caseDoc, 'cancelled', appointment.time);
        } else if (req.body.date && new Date(req.body.date).getTime() !== new Date(previousDate).getTime()) {
            await appendCaseActivity(
                caseDoc,
                'rescheduled',
                `${appointment.time} · ${appointment.month}`
            );
        }
    }

    res.status(200).json({
        success: true,
        message: 'Appointment updated successfully',
        data: {
            appointment: formatAppointment(appointment),
        },
    });
});

module.exports = {
    createAppointment,
    listAppointments,
    getAppointment,
    updateAppointment,
};

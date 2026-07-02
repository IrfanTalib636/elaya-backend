const Session = require('../models/sessionModel');
const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
    isCustomer,
    canManageSessions,
    assertCaseAccess,
    assertSessionAccess,
    buildScopedFilter,
} = require('../utils/accessHelpers');
const { getNextSessionNumber, syncCaseSessionStats } = require('../utils/sessionHelpers');
const {
    processNewSessionElaycoins,
    processNoShowMalus,
    processFinalizedSessionElaycoins,
} = require('../utils/elaycoinEngine');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

const CUSTOMER_SESSION_SELECT =
    'case customer studio session_number treatment_date treatment_time removal_pct verblassung_prozent is_draft is_no_show zonen_id createdAt updatedAt';

const formatSession = (doc, role) => {
    const s = doc.toObject ? doc.toObject() : doc;
    const base = {
        id: s._id,
        case: s.case,
        customer: s.customer,
        studio: s.studio,
        session_number: s.session_number,
        treatment_date: s.treatment_date,
        treatment_time: s.treatment_time,
        removal_pct: s.removal_pct,
        verblassung_prozent: s.verblassung_prozent,
        is_draft: s.is_draft,
        is_no_show: s.is_no_show,
        zonen_id: s.zonen_id,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
    };

    if (isCustomer(role)) {
        return base;
    }

    return {
        ...base,
        session_id: s.session_id,
        appointment: s.appointment,
        standort_id: s.standort_id,
        standort_name: s.standort_name,
        mitarbeiter_id: s.mitarbeiter_id,
        mitarbeiter_name: s.mitarbeiter_name,
        raum_id: s.raum_id,
        raum_name: s.raum_name,
        dauer_minuten: s.dauer_minuten,
        laser_id: s.laser_id,
        studio_laser_brand: s.studio_laser_brand,
        studio_laser_model: s.studio_laser_model,
        laser_typ: s.laser_typ,
        wavelength_nm: s.wavelength_nm,
        fluence_j_cm2: s.fluence_j_cm2,
        spot_size_mm: s.spot_size_mm,
        frequency_hz: s.frequency_hz,
        pass_count: s.pass_count,
        cooling_used: s.cooling_used,
        endpoint_reaction: s.endpoint_reaction,
        pain_score_0_10: s.pain_score_0_10,
        adverse_event_flag: s.adverse_event_flag,
        adverse_event_type: s.adverse_event_type,
        special_notes: s.special_notes,
        fortschritt_foto_data: s.fortschritt_foto_data,
        zahlung: s.zahlung,
    };
};

const validateLinkedAppointment = async (appointmentId, caseDoc) => {
    if (!appointmentId) {
        return null;
    }

    const appointment = await Appointment.findById(appointmentId).select('case').lean();

    if (!appointment) {
        throw new ApiError(404, 'Linked appointment not found');
    }

    if (appointment.case.toString() !== caseDoc._id.toString()) {
        throw new ApiError(400, 'appointment_id does not belong to this case');
    }

    return appointmentId;
};

const createSession = asyncHandler(async (req, res) => {
    if (!canManageSessions(req.user.role)) {
        throw new ApiError(403, 'Only studio staff or admins can record sessions');
    }

    const { case_id, appointment_id, zahlung, ...fields } = req.body;

    const caseDoc = await Case.findById(case_id);
    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    assertCaseAccess(req.user, caseDoc);

    const linkedAppointment = await validateLinkedAppointment(appointment_id, caseDoc);
    const session_number = await getNextSessionNumber(caseDoc._id);

    const session = await Session.create({
        ...fields,
        case: caseDoc._id,
        customer: caseDoc.customer,
        studio: caseDoc.studio,
        session_number,
        session_id: `s${session_number}-${caseDoc._id.toString().slice(-6)}`,
        appointment: linkedAppointment,
        ...(zahlung ? { zahlung } : {}),
    });

    if (!session.is_draft && !session.is_no_show) {
        await syncCaseSessionStats(caseDoc._id);
    }

    if (!session.is_draft) {
        try {
            await processNewSessionElaycoins(session, caseDoc);
        } catch (err) {
            console.error('[ELAYCOIN] createSession:', err.message);
        }
    }

    res.status(201).json({
        success: true,
        message: 'Session recorded successfully',
        data: {
            session: formatSession(session, req.user.role),
        },
    });
});

const listSessions = asyncHandler(async (req, res) => {
    const filter = buildScopedFilter(req.user);

    if (req.query.case_id) {
        filter.case = req.query.case_id;
    }
    if (req.query.customer_id && !isCustomer(req.user.role)) {
        filter.customer = req.query.customer_id;
    }
    if (req.query.is_draft === 'true') {
        filter.is_draft = true;
    }
    if (req.query.is_draft === 'false') {
        filter.is_draft = false;
    }
    if (req.query.from || req.query.to) {
        filter.treatment_date = {};
        if (req.query.from) {
            filter.treatment_date.$gte = new Date(req.query.from);
        }
        if (req.query.to) {
            filter.treatment_date.$lte = new Date(req.query.to);
        }
    }

    const { page, limit, skip } = parsePagination(req.query);
    const selectFields = isCustomer(req.user.role) ? CUSTOMER_SESSION_SELECT : '';

    const sessionQuery = Session.find(filter)
        .populate('case', 'caseId bodyLabel tc_title')
        .populate('customer', 'vorname nachname')
        .sort({ treatment_date: -1 })
        .skip(skip)
        .limit(limit);
    if (selectFields) {
        sessionQuery.select(selectFields);
    }

    const [sessions, total] = await Promise.all([
        sessionQuery.lean(),
        Session.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            sessions: sessions.map((s) => formatSession(s, req.user.role)),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const getSession = asyncHandler(async (req, res) => {
    const session = await Session.findById(req.params.id);

    if (!session) {
        throw new ApiError(404, 'Session not found');
    }

    assertSessionAccess(req.user, session);

    res.status(200).json({
        success: true,
        data: {
            session: formatSession(session, req.user.role),
        },
    });
});

const updateSession = asyncHandler(async (req, res) => {
    if (!canManageSessions(req.user.role)) {
        throw new ApiError(403, 'Only studio staff or admins can update sessions');
    }

    const session = await Session.findById(req.params.id);

    if (!session) {
        throw new ApiError(404, 'Session not found');
    }

    assertSessionAccess(req.user, session);

    const wasDraft = session.is_draft;
    const wasNoShow = session.is_no_show;

    const { appointment_id, zahlung, ...fields } = req.body;

    if (appointment_id !== undefined) {
        const caseDoc = await Case.findById(session.case);
        session.appointment = await validateLinkedAppointment(appointment_id, caseDoc);
    }

    Object.assign(session, fields);

    if (zahlung) {
        session.zahlung = { ...(session.zahlung || {}), ...zahlung };
    }

    await session.save();
    await syncCaseSessionStats(session.case);

    const caseDoc = await Case.findById(session.case);
    if (caseDoc) {
        try {
            if (wasDraft && !session.is_draft) {
                await processFinalizedSessionElaycoins(session, caseDoc);
            } else if (!wasNoShow && session.is_no_show) {
                await processNoShowMalus(session, caseDoc);
            }
        } catch (err) {
            console.error('[ELAYCOIN] updateSession:', err.message);
        }
    }

    res.status(200).json({
        success: true,
        message: 'Session updated successfully',
        data: {
            session: formatSession(session, req.user.role),
        },
    });
});

module.exports = {
    createSession,
    listSessions,
    getSession,
    updateSession,
};

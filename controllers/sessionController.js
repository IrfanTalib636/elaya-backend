const Session = require('../models/sessionModel');
const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const Appointment = require('../models/appointmentModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
    isCustomer,
    isStudio,
    canManageSessions,
    assertCaseAccess,
    assertCaseWriteAccess,
    assertSessionAccess,
    buildScopedFilter,
    buildStudioSharedFilter,
    refId,
} = require('../utils/accessHelpers');
const { getNextSessionNumber, syncCaseSessionStats } = require('../utils/sessionHelpers');
const { syncCustomerPipeline } = require('../utils/pipelineEngine');
const {
    processNewSessionElaycoins,
    processNoShowMalus,
    processFinalizedSessionElaycoins,
} = require('../utils/elaycoinEngine');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { APPOINTMENT_STATUS, APPOINTMENT_TYPE } = require('../config/constants');
const { evaluateAndApplySessionLightening } = require('../utils/lighteningSessionService');
const { emitAvailabilityChanged } = require('../sockets/availabilityEmit');

const CUSTOMER_SESSION_SELECT =
    'case customer studio session_number treatment_date treatment_time removal_pct verblassung_prozent comparison_eligible uncertainty_level progress_direction lightening_confidence verblassung_ki fortschritt_foto_file_id is_draft is_no_show zonen_id createdAt updatedAt';

const customerLighteningNote = (sessionDoc = {}) => {
    if (sessionDoc.comparison_eligible !== false) return null;
    return (sessionDoc.comparison_reasons || []).includes('too_early')
        ? 'too_early'
        : 'no_reliable_comparison';
};

const formatVerblassungKiForRole = (ki, role, sessionDoc = {}) => {
    if (!ki) return null;
    const noteKey = customerLighteningNote(sessionDoc);
    const eligible = sessionDoc.comparison_eligible !== false;
    const customerSafe = {
        status: ki.status || '',
        beurteilung: ki.beurteilung || '',
        fortschritt: eligible ? ki.fortschritt || '' : '',
        lifestyle_tipps: ki.lifestyle_tipps || '',
        empfehlung_kunde: ki.empfehlung_kunde || '',
        wichtiger_hinweis: ki.wichtiger_hinweis || '',
        farben_analyse: eligible ? ki.farben_analyse || null : null,
        analysed_at: ki.analysed_at || null,
        comparison_eligible: sessionDoc.comparison_eligible ?? ki.comparison_eligible ?? null,
        uncertainty_level: sessionDoc.uncertainty_level || ki.uncertainty_level || null,
        progress_direction: eligible
            ? sessionDoc.progress_direction || ki.progress_direction || null
            : 'unclear',
        percent_estimate: eligible ? sessionDoc.verblassung_prozent ?? ki.percent_estimate ?? null : null,
        lightening_note_key: noteKey,
    };
    if (isCustomer(role) && sessionDoc.comparison_eligible === false) {
        customerSafe.beurteilung =
            noteKey === 'too_early'
                ? 'Ein Vergleich ist noch zu früh (unter 14 Tagen). Ein zuverlässiger Verblassungsfortschritt kann noch nicht angezeigt werden.'
                : 'Kein zuverlässiger Bildvergleich möglich. Ein Fortschrittswert wird deshalb nicht als sicheres Ergebnis angezeigt.';
    }
    if (isCustomer(role)) return customerSafe;
    return {
        ...customerSafe,
        empfehlung_studio: ki.empfehlung_studio || '',
        foto_vorher_file_id: ki.foto_vorher_file_id || '',
        foto_aktuell_file_id: ki.foto_aktuell_file_id || '',
        comparison_reasons: sessionDoc.comparison_reasons || [],
        lightening_internal_pct: sessionDoc.lightening_internal_pct ?? null,
        lightening_score: sessionDoc.lightening_score ?? ki.lightening_score ?? null,
        needs_human_review: sessionDoc.needs_human_review ?? ki.needs_human_review ?? null,
        lightening_confidence: sessionDoc.lightening_confidence || null,
    };
};

const formatSession = (doc, role, options = {}) => {
    const s = doc.toObject ? doc.toObject() : doc;
    const base = {
        id: s._id,
        case: s.case,
        customer: s.customer,
        studio: s.studio,
        session_number: s.session_number,
        treatment_date: s.treatment_date,
        treatment_time: s.treatment_time,
        removal_pct: isCustomer(role) && s.comparison_eligible === false ? null : s.removal_pct,
        verblassung_prozent:
            isCustomer(role) && s.comparison_eligible === false ? null : s.verblassung_prozent,
        percent_estimate:
            isCustomer(role) && s.comparison_eligible === false ? null : s.verblassung_prozent ?? null,
        comparison_eligible: s.comparison_eligible ?? null,
        uncertainty_level: s.uncertainty_level ?? null,
        progress_direction:
            isCustomer(role) && s.comparison_eligible === false
                ? 'unclear'
                : s.progress_direction ?? null,
        lightening_note_key: customerLighteningNote(s),
        verblassung_ki:
            Number(s.session_number) < 2
                ? null
                : formatVerblassungKiForRole(s.verblassung_ki, role, s),
        ki_analysis_available: Number(s.session_number) >= 2,
        fortschritt_foto_file_id: s.fortschritt_foto_file_id
            ? String(s.fortschritt_foto_file_id)
            : null,
        is_draft: s.is_draft,
        is_no_show: s.is_no_show,
        zonen_id: s.zonen_id,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        transferiert: !!(
            options.viewerStudioId &&
            refId(s.studio) !== refId(options.viewerStudioId)
        ),
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
        lightening_internal_pct: s.lightening_internal_pct ?? null,
        lightening_score: s.lightening_score ?? null,
        lightening_confidence: s.lightening_confidence ?? null,
        needs_human_review: s.needs_human_review ?? null,
        lightening_factors: s.lightening_factors || null,
        lightening_studio_pct: s.lightening_studio_pct ?? null,
        lightening_studio_notes: s.lightening_studio_notes || '',
        lightening_studio_reviewed_at: s.lightening_studio_reviewed_at || null,
        comparison_reasons: s.comparison_reasons || [],
        image_quality_ok: s.image_quality_ok ?? null,
        photo_same_angle: s.photo_same_angle ?? null,
        photo_same_distance: s.photo_same_distance ?? null,
        photo_comparable_light: s.photo_comparable_light ?? null,
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

/**
 * Resolve which zone a session belongs to.
 *
 * Zone cases must name a zone, because the session log, fading series and
 * progress are all tracked per zone — an unassigned treatment could not be
 * compared against anything. Single-tattoo cases must not name one.
 */
const resolveSessionZone = async (caseDoc, zonenId) => {
    const requested = typeof zonenId === 'string' ? zonenId.trim() : null;

    if (!caseDoc.zonen_aktiv) {
        if (requested) {
            throw new ApiError(400, 'zonen_id is only valid for cases split into zones');
        }
        return null;
    }

    if (!requested) {
        throw new ApiError(
            400,
            'zonen_id is required for a zone case — each zone keeps its own session log'
        );
    }

    const zone = await CaseZone.findOne({ case: caseDoc._id, zonen_id: requested })
        .select('_id')
        .lean();

    if (!zone) {
        throw new ApiError(400, `zonen_id "${requested}" does not belong to this case`);
    }

    return requested;
};

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const isOpenTreatmentAppointment = (appointment) =>
    appointment &&
    appointment.status === APPOINTMENT_STATUS.GEBUCHT &&
    !appointment.consultationOnly &&
    appointment.type !== APPOINTMENT_TYPE.BERATUNG;

/** Mark the matching booked treatment as completed so it is no longer "upcoming". */
const markAppointmentCompletedForSession = async (session) => {
    if (!session || session.is_draft) return;

    const complete = async (appointmentId) => {
        if (!appointmentId) return;
        await Appointment.findByIdAndUpdate(appointmentId, {
            status: APPOINTMENT_STATUS.COMPLETED,
        });
        if (!session.appointment || String(session.appointment) !== String(appointmentId)) {
            session.appointment = appointmentId;
            await session.save();
        }
    };

    if (session.appointment) {
        await complete(session.appointment);
        return;
    }

    const open = await Appointment.find({
        case: session.case,
        status: APPOINTMENT_STATUS.GEBUCHT,
    })
        .sort({ date: 1 })
        .select('_id date status consultationOnly type')
        .lean();

    const treatments = open.filter(isOpenTreatmentAppointment);
    if (!treatments.length) return;

    if (session.treatment_date) {
        const sessionDay = startOfDay(session.treatment_date).getTime();
        const sameDay = treatments.find(
            (appointment) =>
                appointment.date && startOfDay(appointment.date).getTime() === sessionDay
        );
        if (sameDay) {
            await complete(sameDay._id);
            return;
        }
    }

    await complete(treatments[0]._id);
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

    await assertCaseWriteAccess(req.user, caseDoc);

    const linkedAppointment = await validateLinkedAppointment(appointment_id, caseDoc);

    if (linkedAppointment) {
        const existing = await Session.findOne({ appointment: linkedAppointment }).select('_id').lean();
        if (existing) {
            throw new ApiError(400, 'Für diesen Termin wurde bereits eine Sitzung dokumentiert');
        }
    }

    const zonenId = await resolveSessionZone(caseDoc, fields.zonen_id);
    const session_number = await getNextSessionNumber(caseDoc._id, zonenId);

    const session = await Session.create({
        ...fields,
        case: caseDoc._id,
        customer: caseDoc.customer,
        studio: caseDoc.studio,
        zonen_id: zonenId,
        session_number,
        session_id: zonenId
            ? `s${session_number}-${zonenId}-${caseDoc._id.toString().slice(-6)}`
            : `s${session_number}-${caseDoc._id.toString().slice(-6)}`,
        appointment: linkedAppointment,
        ...(zahlung ? { zahlung } : {}),
    });

    const enteredFade = fields.verblassung_prozent ?? fields.removal_pct;
    await evaluateAndApplySessionLightening(session, caseDoc, {
        visual_fade_pct: Number(enteredFade) > 0 ? Number(enteredFade) : null,
    });
    if (session.isModified()) await session.save();

    if (!session.is_draft && !session.is_no_show) {
        await syncCaseSessionStats(caseDoc._id);
        await syncCustomerPipeline(caseDoc.customer);
    }

    if (!session.is_draft) {
        await markAppointmentCompletedForSession(session);
    }

    if (!session.is_draft) {
        try {
            await processNewSessionElaycoins(session, caseDoc);
        } catch (err) {
            console.error('[ELAYCOIN] createSession:', err.message);
        }
    }

    // A documented treatment starts the same-case interval and the cross-case
    // blocking period for the customer's other tattoos.
    emitAvailabilityChanged({
        customerId: caseDoc.customer,
        studioId: caseDoc.studio,
        reason: 'session_created',
    });

    res.status(201).json({
        success: true,
        message: 'Session recorded successfully',
        data: {
            session: formatSession(session, req.user.role),
        },
    });
});

const listSessions = asyncHandler(async (req, res) => {
    let filter;
    const viewerStudioId = isStudio(req.user.role) ? req.user.studio_id : null;

    if (isStudio(req.user.role)) {
        if (req.query.customer_id) {
            const Customer = require('../models/customerModel');
            const assigned = await Customer.findOne({
                _id: req.query.customer_id,
                aktuelle_firma_id: req.user.studio_id,
            })
                .select('_id')
                .lean();
            filter = assigned
                ? { customer: req.query.customer_id }
                : { customer: req.query.customer_id, studio: req.user.studio_id };
        } else {
            filter = await buildStudioSharedFilter(req.user.studio_id);
        }
    } else {
        filter = buildScopedFilter(req.user);
        if (req.query.customer_id && !isCustomer(req.user.role)) {
            filter.customer = req.query.customer_id;
        }
    }

    if (req.query.case_id) {
        filter.case = req.query.case_id;
    }
    // Lets a client show the session log of one zone on its own.
    if (req.query.zonen_id) {
        filter.zonen_id = req.query.zonen_id;
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
            sessions: sessions.map((s) =>
                formatSession(s, req.user.role, { viewerStudioId })
            ),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const getSession = asyncHandler(async (req, res) => {
    const session = await Session.findById(req.params.id);

    if (!session) {
        throw new ApiError(404, 'Session not found');
    }

    const access = await assertSessionAccess(req.user, session);
    const viewerStudioId = isStudio(req.user.role) ? req.user.studio_id : null;
    const formatted = formatSession(session, req.user.role, { viewerStudioId });
    if (access.transferiert) formatted.transferiert = true;
    if (access.read_only) formatted.read_only = true;

    res.status(200).json({
        success: true,
        data: {
            session: formatted,
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

    const access = await assertSessionAccess(req.user, session);
    if (access.read_only) {
        throw new ApiError(
            403,
            'Customer transferred to another studio — this session is read-only'
        );
    }

    const wasDraft = session.is_draft;
    const wasNoShow = session.is_no_show;

    const { appointment_id, zahlung, zonen_id, ...fields } = req.body;

    if (appointment_id !== undefined) {
        const caseDoc = await Case.findById(session.case);
        session.appointment = await validateLinkedAppointment(appointment_id, caseDoc);
    }

    // Reassigning a session to another zone would invalidate both zones' session
    // numbering and fading series, so it is refused rather than silently allowed.
    if (zonen_id !== undefined) {
        const requested = typeof zonen_id === 'string' ? zonen_id.trim() : null;
        if ((requested || null) !== (session.zonen_id || null)) {
            throw new ApiError(
                400,
                'A session cannot be moved to a different zone — delete it and log it on the intended zone'
            );
        }
    }

    Object.assign(session, fields);

    if (zahlung) {
        session.zahlung = { ...(session.zahlung || {}), ...zahlung };
    }

    if (fields.lightening_studio_pct != null || fields.lightening_studio_notes) {
        session.lightening_studio_reviewed_at = new Date();
    }

    const caseDoc = await Case.findById(session.case);
    if (caseDoc) {
        const enteredFade = fields.verblassung_prozent ?? fields.removal_pct;
        await evaluateAndApplySessionLightening(session, caseDoc, {
            visual_fade_pct:
                enteredFade === undefined
                    ? undefined
                    : Number(enteredFade) > 0
                      ? Number(enteredFade)
                      : null,
            studio_review_pct: session.lightening_studio_pct,
        });
    }

    await session.save();
    await syncCaseSessionStats(session.case);
    await syncCustomerPipeline(session.customer);

    if (!session.is_draft) {
        await markAppointmentCompletedForSession(session);
    }

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

    emitAvailabilityChanged({
        customerId: session.customer,
        studioId: session.studio,
        reason: 'session_updated',
    });

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

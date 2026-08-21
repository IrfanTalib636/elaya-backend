const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const Session = require('../models/sessionModel');
const { APPOINTMENT_STATUS, APPOINTMENT_TYPE } = require('../config/constants');

const SAME_CASE_DAYS = 49;
const CROSS_CASE_DAYS = 28;
const UV_MODERATE_DAYS = 21;
const UV_INTENSE_DAYS = 28;
const MED_SHORT_DAYS = 14;
const MED_RETINOID_DAYS = 180;

const CANCELLED_STATUSES = new Set([
    APPOINTMENT_STATUS.STORNIERT,
    APPOINTMENT_STATUS.CANCELLED,
    APPOINTMENT_STATUS.COMPLETED,
]);

const startOfDay = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
};

const addDays = (date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    d.setHours(0, 0, 0, 0);
    return d;
};

const toDateKey = (date) => {
    const d = startOfDay(date);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
};

const fmtLang = (date) =>
    startOfDay(date).toLocaleDateString('de-CH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });

const sperreIstAktiv = (endDate) => {
    if (!endDate) {
        return false;
    }
    return startOfDay(endDate) > startOfDay(new Date());
};

const hasWavelength = (session) => (session.wavelength_nm || []).length > 0;

const isAppointmentCancelled = (appointment) => CANCELLED_STATUSES.has(appointment.status);

const isAppointmentCompletedBySession = (appointment, sessions) => {
    if (sessions.some((session) => session.appointment && String(session.appointment) === String(appointment._id))) {
        return true;
    }
    if (!appointment.date) {
        return false;
    }
    const aptDay = startOfDay(appointment.date).getTime();
    return sessions.some(
        (session) =>
            session.treatment_date && startOfDay(session.treatment_date).getTime() === aptDay
    );
};

const isOpenTreatmentAppointment = (appointment) =>
    appointment &&
    appointment.status === APPOINTMENT_STATUS.GEBUCHT &&
    !appointment.consultationOnly &&
    appointment.type !== APPOINTMENT_TYPE.BERATUNG;

/** Close booked treatments that already have a documented session (stale "upcoming" rows). */
const reconcileAppointmentsCoveredBySessions = async (appointments, sessions) => {
    const ids = new Set();
    const sessionsByCase = groupByCaseId(sessions);
    const appointmentsByCase = groupByCaseId(appointments);

    for (const [caseId, caseSessions] of sessionsByCase.entries()) {
        const documented = caseSessions.filter((session) => session.treatment_date);
        if (!documented.length) continue;

        const caseAppointments = appointmentsByCase.get(caseId) || [];
        const openTreatments = caseAppointments.filter(isOpenTreatmentAppointment);

        for (const session of documented) {
            if (session.appointment) ids.add(String(session.appointment));
            const day = startOfDay(session.treatment_date).getTime();
            for (const appointment of openTreatments) {
                if (appointment.date && startOfDay(appointment.date).getTime() === day) {
                    ids.add(String(appointment._id));
                }
            }
        }

        if (openTreatments.length === 1 && documented.length >= 1) {
            const appointment = openTreatments[0];
            const latestSessionCreated = Math.max(
                ...documented.map((session) => new Date(session.createdAt || session.treatment_date).getTime())
            );
            const appointmentCreated = new Date(
                appointment.createdAt || appointment.date || 0
            ).getTime();
            if (appointmentCreated && appointmentCreated <= latestSessionCreated) {
                ids.add(String(appointment._id));
            }
        }
    }

    const pending = [...ids].filter((id) =>
        appointments.some(
            (appointment) =>
                String(appointment._id) === id && appointment.status === APPOINTMENT_STATUS.GEBUCHT
        )
    );
    if (!pending.length) return [];

    await Appointment.updateMany(
        { _id: { $in: pending }, status: APPOINTMENT_STATUS.GEBUCHT },
        { $set: { status: APPOINTMENT_STATUS.COMPLETED } }
    );
    return pending;
};

const isCrossCaseAppointment = (appointment) =>
    !appointment.consultationOnly && appointment.type !== APPOINTMENT_TYPE.BERATUNG;

const groupByCaseId = (items) => {
    const map = new Map();
    for (const item of items) {
        const key = item.case.toString();
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(item);
    }
    return map;
};

const normalizePreSessionCheck = (check = {}) => {
    const normalized = { ...check };

    if (check.uv_level) {
        const uvMap = {
            none: 'keine',
            moderate: 'mittel',
            intense: 'intensiv',
        };
        normalized.uv_exposition = uvMap[check.uv_level] || normalized.uv_exposition;
    }

    if (Array.isArray(normalized.medikamente)) {
        normalized.medikamente = normalized.medikamente.filter(
            (item) => item && item !== 'keine'
        );
    } else if (typeof normalized.medikamente === 'string' && normalized.medikamente.trim()) {
        normalized.medikamente = normalized.medikamente
            .split(',')
            .map((m) => m.trim())
            .filter((item) => item && item !== 'keine');
    } else if (!normalized.medikamente) {
        normalized.medikamente = [];
    }

    // Empty meds → no intake date. Also drop invalid/epoch dates from null coercion.
    if (!normalized.medikamente.length) {
        normalized.medikament_datum = undefined;
    } else if (normalized.medikament_datum) {
        const ts = new Date(normalized.medikament_datum).getTime();
        if (Number.isNaN(ts) || ts === 0) {
            normalized.medikament_datum = undefined;
        }
    }

    return normalized;
};

const parsePreSessionCheck = (input = {}) => {
    if (input.preSessionCheck && typeof input.preSessionCheck === 'object') {
        return normalizePreSessionCheck(input.preSessionCheck);
    }

    return normalizePreSessionCheck({
        uv_level: input.uv_level,
        uv_exposition: input.uv_exposition,
        medikamente: input.medikamente,
        medikament_datum: input.medikament_datum,
    });
};

const isLockoutDisabled = (caseDoc) => {
    const override = caseDoc?.sperrfrist_deaktiviert;
    if (!override?.aktiv || !override.deaktiviert_bis) {
        return false;
    }
    return new Date() < new Date(override.deaktiviert_bis);
};

const mkSperre = (heute, typ, grund, bisDate, extra = {}) => {
    const bis = startOfDay(bisDate);
    return {
        typ,
        grund,
        von: new Date(heute),
        bis,
        bis_string: fmtLang(addDays(bis, -1)),
        ...extra,
    };
};

const serializeSperre = (sperre) => ({
    typ: sperre.typ,
    grund: sperre.grund,
    von: toDateKey(sperre.von),
    bis: toDateKey(sperre.bis),
    bis_string: sperre.bis_string,
    ...(sperre.case_name ? { case_name: sperre.case_name } : {}),
});

const serializeFreeWindow = (window) => ({
    von: toDateKey(window.von),
    bis: window.bis ? toDateKey(window.bis) : null,
    von_string: window.von_string,
    bis_string: window.bis_string,
});

const tagIstGesperrt = (datum, sperren) => {
    const tag = startOfDay(datum);
    return sperren.find((sperre) => tag >= sperre.von && tag < sperre.bis) || null;
};

const berechneAlleSperren = ({
    activeCaseId,
    cases,
    appointmentsByCase,
    sessionsByCase,
    preSessionCheck = {},
    consultationOnly = false,
    lockoutDisabled = false,
}) => {
    const heute = startOfDay(new Date());
    const activeCaseIdStr = activeCaseId.toString();
    const activeCase = cases.find((c) => c._id.toString() === activeCaseIdStr);

    if (consultationOnly || lockoutDisabled) {
        return {
            sperren: [],
            frei_fenster: [
                {
                    von: new Date(heute),
                    bis: null,
                    von_string: fmtLang(heute),
                    bis_string: null,
                },
            ],
            fruehestes: heute,
        };
    }

    const sperren = [];

    if (activeCase) {
        const activeSessions = sessionsByCase.get(activeCaseIdStr) || [];
        const activeAppointments = appointmentsByCase.get(activeCaseIdStr) || [];

        const sessionDates = activeSessions
            .filter((session) => session.treatment_date)
            .map((session) => startOfDay(session.treatment_date));

        const futureAppointmentDates = activeAppointments
            .filter(
                (appointment) =>
                    !isAppointmentCancelled(appointment) &&
                    !isAppointmentCompletedBySession(appointment, activeSessions) &&
                    isCrossCaseAppointment(appointment) &&
                    startOfDay(appointment.date) >= heute
            )
            .map((appointment) => startOfDay(appointment.date));

        const latestSession =
            sessionDates.length > 0
                ? new Date(Math.max(...sessionDates.map((d) => d.getTime())))
                : null;

        const latestFutureAppt =
            futureAppointmentDates.length > 0
                ? new Date(Math.max(...futureAppointmentDates.map((d) => d.getTime())))
                : null;

        let latestRef = null;
        let referenceType = 'Sitzung';

        if (latestSession && latestFutureAppt) {
            if (latestFutureAppt.getTime() >= latestSession.getTime()) {
                latestRef = latestFutureAppt;
                referenceType = 'Termin';
            } else {
                latestRef = latestSession;
            }
        } else if (latestFutureAppt) {
            latestRef = latestFutureAppt;
            referenceType = 'Termin';
        } else if (latestSession) {
            latestRef = latestSession;
        }

        if (latestRef) {
            const sameCaseUntil = addDays(latestRef, SAME_CASE_DAYS);
            if (sameCaseUntil > heute) {
                const caseTitle = activeCase.tc_title || activeCase.bodyLabel || 'Dieser Case';
                const refLabel = referenceType === 'Termin' ? 'Termin vom' : 'Sitzung vom';
                sperren.push(
                    mkSperre(
                        heute,
                        'same_case',
                        `⏳ ${SAME_CASE_DAYS} Tage · ${caseTitle} · ${refLabel} ${fmtLang(latestRef)}`,
                        sameCaseUntil
                    )
                );
            }
        }
    }

    for (const caseDoc of cases) {
        const caseIdStr = caseDoc._id.toString();
        if (caseIdStr === activeCaseIdStr) {
            continue;
        }

        const caseName = caseDoc.tc_title || caseDoc.bodyLabel || 'Unbekannt';
        const caseSessions = sessionsByCase.get(caseIdStr) || [];
        const caseAppointments = appointmentsByCase.get(caseIdStr) || [];

        const realTreatments = caseSessions
            .filter((session) => session.treatment_date && hasWavelength(session))
            .sort((a, b) => new Date(b.treatment_date) - new Date(a.treatment_date));

        let referenceDate = null;
        let referenceType = '';

        if (realTreatments.length > 0) {
            referenceDate = startOfDay(realTreatments[0].treatment_date);
            referenceType = 'Behandlung';
        }

        const futureAppointments = caseAppointments
            .filter(
                (appointment) =>
                    appointment.date &&
                    !isAppointmentCancelled(appointment) &&
                    !isAppointmentCompletedBySession(appointment, caseSessions) &&
                    isCrossCaseAppointment(appointment) &&
                    startOfDay(appointment.date) >= heute
            )
            .sort((a, b) => startOfDay(b.date) - startOfDay(a.date));

        if (futureAppointments.length > 0) {
            const appointmentDate = startOfDay(futureAppointments[0].date);
            if (!referenceDate || appointmentDate > referenceDate) {
                referenceDate = appointmentDate;
                referenceType = 'Termin';
            }
        }

        if (!referenceDate) {
            continue;
        }

        const crossCaseUntil = addDays(referenceDate, CROSS_CASE_DAYS);
        if (crossCaseUntil > heute) {
            const referenceLabel = fmtLang(referenceDate);
            const grund =
                referenceType === 'Termin'
                    ? `⏳ ${CROSS_CASE_DAYS} Tage nach Termin "${caseName}" (${referenceLabel})`
                    : `⏳ ${CROSS_CASE_DAYS} Tage nach Behandlung "${caseName}" (${referenceLabel})`;

            sperren.push(
                mkSperre(heute, 'cross_case', grund, crossCaseUntil, {
                    case_name: caseName,
                })
            );
        }
    }

    const normalizedCheck = normalizePreSessionCheck(preSessionCheck);
    if (normalizedCheck.uv_exposition === 'intensiv') {
        sperren.push(
            mkSperre(
                heute,
                'global',
                `☀️ ${UV_INTENSE_DAYS} Tage nach intensiver UV-Exposition`,
                addDays(heute, UV_INTENSE_DAYS)
            )
        );
    } else if (normalizedCheck.uv_exposition === 'mittel') {
        sperren.push(
            mkSperre(
                heute,
                'global',
                `☀️ ${UV_MODERATE_DAYS} Tage nach mittlerer UV-Exposition`,
                addDays(heute, UV_MODERATE_DAYS)
            )
        );
    }

    const meds = normalizedCheck.medikamente || [];
    const intakeDate = normalizedCheck.medikament_datum
        ? startOfDay(normalizedCheck.medikament_datum)
        : heute;

    if (meds.includes('retinoide')) {
        const until = addDays(intakeDate, MED_RETINOID_DAYS);
        if (until > heute) {
            sperren.push(mkSperre(heute, 'global', '💊 180 Tage nach Retinoiden', until));
        }
    }
    if (meds.includes('antibiotika')) {
        const until = addDays(intakeDate, MED_SHORT_DAYS);
        if (until > heute) {
            sperren.push(mkSperre(heute, 'global', '💊 14 Tage nach Antibiotika', until));
        }
    }
    if (meds.includes('antidepressiva')) {
        const until = addDays(intakeDate, MED_SHORT_DAYS);
        if (until > heute) {
            sperren.push(mkSperre(heute, 'global', '💊 14 Tage nach Antidepressiva', until));
        }
    }

    let maxUvBlock = null;
    let maxMedBlock = null;
    for (const caseDoc of cases) {
        if (sperreIstAktiv(caseDoc.uvBlockDate)) {
            const blockDate = startOfDay(caseDoc.uvBlockDate);
            if (!maxUvBlock || blockDate > maxUvBlock) {
                maxUvBlock = blockDate;
            }
        }
        if (sperreIstAktiv(caseDoc.medicationBlockDate)) {
            const blockDate = startOfDay(caseDoc.medicationBlockDate);
            if (!maxMedBlock || blockDate > maxMedBlock) {
                maxMedBlock = blockDate;
            }
        }
    }

    if (maxUvBlock) {
        sperren.push(
            mkSperre(heute, 'global', '☀️ UV-Sperre aktiv', maxUvBlock)
        );
    }
    if (maxMedBlock) {
        sperren.push(
            mkSperre(heute, 'global', '💊 Medikamenten-Sperre aktiv', maxMedBlock)
        );
    }

    const activeSperren = sperren.filter((sperre) => sperre.bis > heute);
    activeSperren.sort((a, b) => a.von - b.von);

    const freiFenster = [];
    let cursor = new Date(heute);
    for (const sperre of activeSperren) {
        if (sperre.von > cursor) {
            freiFenster.push({
                von: new Date(cursor),
                bis: new Date(sperre.von),
                von_string: cursor.toLocaleDateString('de-CH', { day: 'numeric', month: 'long' }),
                bis_string: fmtLang(addDays(sperre.von, -1)),
            });
        }
        if (sperre.bis > cursor) {
            cursor = new Date(sperre.bis);
        }
    }
    freiFenster.push({
        von: new Date(cursor),
        bis: null,
        von_string: fmtLang(cursor),
        bis_string: null,
    });

    const fruehestes = freiFenster[0]?.von || heute;

    return { sperren: activeSperren, frei_fenster: freiFenster, fruehestes };
};

const buildBlockedDates = (from, to, sperren, fruehestes) => {
    if (!from || !to) {
        return [];
    }

    const blocked = new Set();
    const start = startOfDay(from);
    const end = startOfDay(to);
    const earliestKey = toDateKey(fruehestes);

    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const key = toDateKey(cursor);
        if (key < earliestKey || tagIstGesperrt(cursor, sperren)) {
            blocked.add(key);
        }
    }

    return [...blocked].sort();
};

const loadLockoutContext = async (customerId) => {
    const [cases, appointments, sessions] = await Promise.all([
        Case.find({ customer: customerId }).lean(),
        Appointment.find({
            customer: customerId,
            status: { $nin: [APPOINTMENT_STATUS.STORNIERT, APPOINTMENT_STATUS.CANCELLED] },
        }).lean(),
        Session.find({ customer: customerId, is_draft: false, is_no_show: false }).lean(),
    ]);

    const healed = await reconcileAppointmentsCoveredBySessions(appointments, sessions);
    const nextAppointments = healed.length
        ? appointments.map((appointment) => {
              const id = String(appointment._id);
              if (!healed.includes(id)) return appointment;
              return { ...appointment, status: APPOINTMENT_STATUS.COMPLETED };
          })
        : appointments;

    return {
        cases,
        appointmentsByCase: groupByCaseId(nextAppointments),
        sessionsByCase: groupByCaseId(sessions),
    };
};

const computeAvailability = async ({
    activeCaseId,
    customerId,
    consultationOnly = false,
    preSessionCheck = {},
    from = null,
    to = null,
}) => {
    const context = await loadLockoutContext(customerId);
    const activeCase = context.cases.find((c) => c._id.toString() === activeCaseId.toString());

    const { sperren, frei_fenster, fruehestes } = berechneAlleSperren({
        activeCaseId,
        cases: context.cases,
        appointmentsByCase: context.appointmentsByCase,
        sessionsByCase: context.sessionsByCase,
        preSessionCheck,
        consultationOnly,
        lockoutDisabled: activeCase ? isLockoutDisabled(activeCase) : false,
    });

    let blockedDates = buildBlockedDates(from, to, sperren, fruehestes);
    let studio_schedule = null;
    if (from && to && activeCase?.studio) {
        const Studio = require('../models/studioModel');
        const { collectClosedDates, buildStudioScheduleSnapshot } = require('./studioHours');
        const studio = await Studio.findById(activeCase.studio)
            .select('oeffnungszeiten oeffnungs_ausnahmen pufferzeit_minuten')
            .lean();
        if (studio) {
            const closed = collectClosedDates(studio, from, to);
            blockedDates = [...new Set([...blockedDates, ...closed])].sort();
            studio_schedule = buildStudioScheduleSnapshot(studio);
        }
    }

    return {
        case_id: activeCaseId.toString(),
        consultationOnly,
        preSessionCheck,
        fruehestes: toDateKey(fruehestes),
        sperren: sperren.map(serializeSperre),
        frei_fenster: frei_fenster.map(serializeFreeWindow),
        blocked_dates: blockedDates,
        studio_schedule,
    };
};

const isBookingDateAllowed = (date, availability) => {
    const dayKey = toDateKey(date);

    if (dayKey < availability.fruehestes) {
        return {
            allowed: false,
            message: `Termin zu früh. Frühestens buchbar ab ${availability.fruehestes} (Sperrfrist).`,
            fruehestes: availability.fruehestes,
        };
    }

    if (availability.blocked_dates.includes(dayKey)) {
        return {
            allowed: false,
            message: 'Dieser Tag ist durch eine aktive Sperrfrist blockiert.',
            fruehestes: availability.fruehestes,
        };
    }

    return { allowed: true };
};

const assertBookingDateAllowed = async ({
    caseId,
    customerId,
    date,
    consultationOnly = false,
    preSessionCheck = {},
}) => {
    if (consultationOnly) {
        const availability = await computeAvailability({
            activeCaseId: caseId,
            customerId,
            consultationOnly: true,
            preSessionCheck: {},
            from: date,
            to: date,
        });
        const dayKey = toDateKey(date);
        if (availability.blocked_dates.includes(dayKey)) {
            const ApiError = require('./ApiError');
            throw new ApiError(400, 'Das Studio ist an diesem Tag geschlossen.');
        }
        return;
    }

    const availability = await computeAvailability({
        activeCaseId: caseId,
        customerId,
        consultationOnly: false,
        preSessionCheck,
        from: date,
        to: date,
    });

    const result = isBookingDateAllowed(date, availability);
    if (!result.allowed) {
        const ApiError = require('./ApiError');
        throw new ApiError(400, result.message, { fruehestes: result.fruehestes });
    }
};

module.exports = {
    computeAvailability,
    isBookingDateAllowed,
    assertBookingDateAllowed,
    berechneAlleSperren,
    parsePreSessionCheck,
    normalizePreSessionCheck,
    loadLockoutContext,
    tagIstGesperrt,
    startOfDay,
    toDateKey,
};

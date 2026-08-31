const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const Session = require('../models/sessionModel');
const { APPOINTMENT_STATUS, APPOINTMENT_TYPE } = require('../config/constants');
const { PLATFORM_CONFIG_DEFAULTS } = require('../config/platformDefaults');

/**
 * Blocking periods are studio configuration, never constants. These platform
 * defaults only apply when a caller has no studio context (e.g. a case that is
 * not yet attached to a studio).
 */
const resolveSperrfristen = (sperrfristen) => ({
    ...PLATFORM_CONFIG_DEFAULTS.sperrfristen,
    ...(sperrfristen || {}),
});

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

/**
 * `grund` is a ready-made German sentence. `kategorie` and `tage` are the
 * machine-readable equivalents so clients can render the reason in the
 * customer's own language.
 */
const serializeSperre = (sperre) => ({
    typ: sperre.typ,
    grund: sperre.grund,
    von: toDateKey(sperre.von),
    bis: toDateKey(sperre.bis),
    bis_string: sperre.bis_string,
    ...(sperre.kategorie ? { kategorie: sperre.kategorie } : {}),
    ...(sperre.tage != null ? { tage: sperre.tage } : {}),
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
    sperrfristen = null,
}) => {
    const {
        same_case_tage: SAME_CASE_DAYS,
        cross_case_tage: CROSS_CASE_DAYS,
        uv_mittel_tage: UV_MODERATE_DAYS,
        uv_intensiv_tage: UV_INTENSE_DAYS,
        medikament_kurz_tage: MED_SHORT_DAYS,
        medikament_retinoide_tage: MED_RETINOID_DAYS,
    } = resolveSperrfristen(sperrfristen);

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

        if (latestRef && SAME_CASE_DAYS > 0) {
            const sameCaseUntil = addDays(latestRef, SAME_CASE_DAYS);
            if (sameCaseUntil > heute) {
                const caseTitle = activeCase.tc_title || activeCase.bodyLabel || 'Dieser Case';
                const refLabel = referenceType === 'Termin' ? 'Termin vom' : 'Sitzung vom';
                sperren.push(
                    mkSperre(
                        heute,
                        'same_case',
                        `⏳ ${SAME_CASE_DAYS} Tage · ${caseTitle} · ${refLabel} ${fmtLang(latestRef)}`,
                        sameCaseUntil,
                        {
                            kategorie: 'same_case',
                            tage: SAME_CASE_DAYS,
                            case_name: caseTitle,
                        }
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
        if (CROSS_CASE_DAYS > 0 && crossCaseUntil > heute) {
            const referenceLabel = fmtLang(referenceDate);
            const grund =
                referenceType === 'Termin'
                    ? `⏳ ${CROSS_CASE_DAYS} Tage nach Termin "${caseName}" (${referenceLabel})`
                    : `⏳ ${CROSS_CASE_DAYS} Tage nach Behandlung "${caseName}" (${referenceLabel})`;

            sperren.push(
                mkSperre(heute, 'cross_case', grund, crossCaseUntil, {
                    kategorie: 'cross_case',
                    tage: CROSS_CASE_DAYS,
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
                addDays(heute, UV_INTENSE_DAYS),
                { kategorie: 'uv', tage: UV_INTENSE_DAYS }
            )
        );
    } else if (normalizedCheck.uv_exposition === 'mittel') {
        sperren.push(
            mkSperre(
                heute,
                'global',
                `☀️ ${UV_MODERATE_DAYS} Tage nach mittlerer UV-Exposition`,
                addDays(heute, UV_MODERATE_DAYS),
                { kategorie: 'uv', tage: UV_MODERATE_DAYS }
            )
        );
    }

    const meds = normalizedCheck.medikamente || [];
    const intakeDate = normalizedCheck.medikament_datum
        ? startOfDay(normalizedCheck.medikament_datum)
        : heute;

    const medKategorie = (tage) => ({ kategorie: 'medikament', tage });

    if (meds.includes('retinoide')) {
        const until = addDays(intakeDate, MED_RETINOID_DAYS);
        if (until > heute) {
            sperren.push(
                mkSperre(
                    heute,
                    'global',
                    `💊 ${MED_RETINOID_DAYS} Tage nach Retinoiden`,
                    until,
                    medKategorie(MED_RETINOID_DAYS)
                )
            );
        }
    }
    if (meds.includes('antibiotika')) {
        const until = addDays(intakeDate, MED_SHORT_DAYS);
        if (until > heute) {
            sperren.push(
                mkSperre(
                    heute,
                    'global',
                    `💊 ${MED_SHORT_DAYS} Tage nach Antibiotika`,
                    until,
                    medKategorie(MED_SHORT_DAYS)
                )
            );
        }
    }
    if (meds.includes('antidepressiva')) {
        const until = addDays(intakeDate, MED_SHORT_DAYS);
        if (until > heute) {
            sperren.push(
                mkSperre(
                    heute,
                    'global',
                    `💊 ${MED_SHORT_DAYS} Tage nach Antidepressiva`,
                    until,
                    medKategorie(MED_SHORT_DAYS)
                )
            );
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

    // Stored block dates carry no duration — only the end date is known.
    if (maxUvBlock) {
        sperren.push(
            mkSperre(heute, 'global', '☀️ UV-Sperre aktiv', maxUvBlock, { kategorie: 'uv' })
        );
    }
    if (maxMedBlock) {
        sperren.push(
            mkSperre(heute, 'global', '💊 Medikamenten-Sperre aktiv', maxMedBlock, {
                kategorie: 'medikament',
            })
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

/** First day that satisfies the studio's minimum lead time. */
const earliestFromLeadTime = (hours) => {
    const lead = Number(hours) || 0;
    if (lead <= 0) {
        return startOfDay(new Date());
    }
    const threshold = new Date(Date.now() + lead * 60 * 60 * 1000);
    return startOfDay(threshold);
};

/** Last day customers may book, derived from the studio's booking horizon. */
const latestFromHorizon = (days) => addDays(new Date(), Math.max(1, Number(days) || 1));

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
    standortId = null,
}) => {
    const context = await loadLockoutContext(customerId);
    const activeCase = context.cases.find((c) => c._id.toString() === activeCaseId.toString());

    const { getEffectiveBookingConfig } = require('./configService');
    const { sperrfristen, termin_einstellungen } = await getEffectiveBookingConfig(
        activeCase?.studio || null
    );

    const { sperren, frei_fenster, fruehestes: lockoutEarliest } = berechneAlleSperren({
        activeCaseId,
        cases: context.cases,
        appointmentsByCase: context.appointmentsByCase,
        sessionsByCase: context.sessionsByCase,
        preSessionCheck,
        consultationOnly,
        lockoutDisabled: activeCase ? isLockoutDisabled(activeCase) : false,
        sperrfristen,
    });

    // A studio may require a lead time; it can only push the earliest date later.
    const leadTimeEarliest = earliestFromLeadTime(termin_einstellungen.min_vorlaufzeit_stunden);
    const fruehestes = leadTimeEarliest > lockoutEarliest ? leadTimeEarliest : lockoutEarliest;

    let blockedDates = buildBlockedDates(from, to, sperren, fruehestes);
    let studio_schedule = null;
    let occupied_times = {};
    if (from && to && activeCase?.studio) {
        const Studio = require('../models/studioModel');
        const Appointment = require('../models/appointmentModel');
        const { APPOINTMENT_STATUS } = require('../config/constants');
        const {
            collectClosedDates,
            buildStudioScheduleSnapshot,
            collectOccupiedTimes,
            resolveStandortSchedule,
        } = require('./studioHours');
        const studio = await Studio.findById(activeCase.studio)
            .select(
                'oeffnungszeiten oeffnungs_ausnahmen pufferzeit_minuten slot_interval_minuten standorte'
            )
            .lean();
        if (studio) {
            // Hours, buffer and slot interval of the selected location, falling
            // back to the studio-wide schedule when it defines no override.
            const schedule = resolveStandortSchedule(studio, standortId);
            const closed = collectClosedDates(schedule, from, to);
            blockedDates = [...new Set([...blockedDates, ...closed])].sort();
            studio_schedule = buildStudioScheduleSnapshot(schedule);
            const booked = await Appointment.find({
                studio: activeCase.studio,
                status: APPOINTMENT_STATUS.GEBUCHT,
                date: { $gte: new Date(from), $lte: new Date(to) },
                // Only this location's bookings occupy its slots. Appointments
                // without a location predate locations and block every location.
                ...(standortId ? { standort_id: { $in: [String(standortId), ''] } } : {}),
            })
                .select('date time dauer_minuten')
                .lean();
            occupied_times = collectOccupiedTimes(
                booked,
                studio_schedule.slot_interval_minuten,
                studio_schedule.pufferzeit_minuten
            );
        }
    }

    const spaetestes = latestFromHorizon(termin_einstellungen.buchung_horizont_tage);
    if (from && to) {
        // Everything past the studio's horizon is unbookable, same as a closed day.
        const beyondHorizon = [];
        const horizonKey = toDateKey(spaetestes);
        for (
            let cursor = startOfDay(from);
            cursor <= startOfDay(to);
            cursor.setDate(cursor.getDate() + 1)
        ) {
            const key = toDateKey(cursor);
            if (key > horizonKey) beyondHorizon.push(key);
        }
        if (beyondHorizon.length) {
            blockedDates = [...new Set([...blockedDates, ...beyondHorizon])].sort();
        }
    }

    return {
        case_id: activeCaseId.toString(),
        consultationOnly,
        preSessionCheck,
        fruehestes: toDateKey(fruehestes),
        /** Last bookable day per the studio's horizon — clients build their range from this. */
        spaetestes: toDateKey(spaetestes),
        sperren: sperren.map(serializeSperre),
        frei_fenster: frei_fenster.map(serializeFreeWindow),
        blocked_dates: blockedDates,
        studio_schedule,
        occupied_times,
        /** Appointment durations, horizon and lead time as configured by the studio. */
        termin_einstellungen,
        /** Blocking periods in days as configured by the studio. */
        sperrfristen,
        standort_id: standortId ? String(standortId) : '',
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
    time = null,
    consultationOnly = false,
    preSessionCheck = {},
    standortId = null,
}) => {
    const availability = await computeAvailability({
        activeCaseId: caseId,
        customerId,
        consultationOnly,
        preSessionCheck: consultationOnly ? {} : preSessionCheck,
        from: date,
        to: date,
        standortId,
    });
    const dayKey = toDateKey(date);
    if (availability.spaetestes && dayKey > availability.spaetestes) {
        const ApiError = require('./ApiError');
        throw new ApiError(
            400,
            `Termine können nur bis ${availability.spaetestes} gebucht werden.`,
            { spaetestes: availability.spaetestes }
        );
    }

    if (availability.blocked_dates.includes(dayKey)) {
        const ApiError = require('./ApiError');
        throw new ApiError(400, 'Das Studio ist an diesem Tag geschlossen.');
    }

    if (!consultationOnly) {
        const result = isBookingDateAllowed(date, availability);
        if (!result.allowed) {
            const ApiError = require('./ApiError');
            throw new ApiError(400, result.message, { fruehestes: result.fruehestes });
        }
    }

    if (time) {
        const {
            isSlotOccupied,
            slotsForStudioDate,
            resolveStandortSchedule,
        } = require('./studioHours');
        const Studio = require('../models/studioModel');
        const Case = require('../models/caseModel');
        const caseDoc = await Case.findById(caseId).select('studio').lean();
        if (caseDoc?.studio) {
            const studio = await Studio.findById(caseDoc.studio)
                .select(
                    'oeffnungszeiten oeffnungs_ausnahmen slot_interval_minuten pufferzeit_minuten standorte'
                )
                .lean();
            if (studio) {
                const schedule = resolveStandortSchedule(studio, standortId);
                const generated = slotsForStudioDate(
                    schedule,
                    dayKey,
                    schedule.slot_interval_minuten
                );
                const hhmm = String(time).slice(0, 5);
                if (!generated.time_slots.includes(hhmm)) {
                    const ApiError = require('./ApiError');
                    throw new ApiError(400, 'This time is outside studio opening hours.');
                }
            }
        }
        if (isSlotOccupied(availability.occupied_times, dayKey, time)) {
            const ApiError = require('./ApiError');
            throw new ApiError(400, 'This time slot is already booked.');
        }
    }
};

module.exports = {
    computeAvailability,
    isBookingDateAllowed,
    assertBookingDateAllowed,
    berechneAlleSperren,
    parsePreSessionCheck,
    normalizePreSessionCheck,
    resolveSperrfristen,
    loadLockoutContext,
    tagIstGesperrt,
    startOfDay,
    toDateKey,
};

const crypto = require('crypto');
const Appointment = require('../models/appointmentModel');
const Case = require('../models/caseModel');
const Anamnesis = require('../models/anamnesisModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertBookingDateAllowed } = require('../utils/lockoutEngine');
const { applyKurzfristigeStornierungMalusIfNeeded } = require('../utils/elaycoinEngine');
const { applyBookingPrecheckToCase } = require('../utils/bookingPrecheckApply');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { syncCustomerPipeline } = require('../utils/pipelineEngine');
const { formatApptStamp } = require('../utils/activityLog');
const { emitAvailabilityChanged } = require('../sockets/availabilityEmit');
const { refId } = require('../utils/accessHelpers');
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
        if (refId(caseDoc.customer) !== refId(user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this case');
        }
        return;
    }

    if (isStudio(user.role)) {
        if (refId(caseDoc.studio) !== refId(user.studio_id)) {
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

    // refId, not .toString(): these refs are populated on some read paths, and a
    // populated document stringifies to its contents rather than its id.
    if (isCustomer(user.role)) {
        if (refId(appointment.customer) !== refId(user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this appointment');
        }
        return;
    }

    if (isStudio(user.role)) {
        if (refId(appointment.studio) !== refId(user.studio_id)) {
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
        // Clients may omit the duration; the studio's configured default applies.
        dauer_minuten: body.dauer_minuten ?? gruppenMeta.default_dauer_minuten ?? null,
        standort_id: body.standort_id ?? '',
        standort_name: body.standort_name ?? '',
        gruppen_termin: gruppenMeta.gruppen_termin ?? false,
        gruppen_id: gruppenMeta.gruppen_id ?? null,
        gruppen_cases: gruppenMeta.gruppen_cases ?? [],
        gruppen_rabatt: gruppenMeta.gruppen_rabatt ?? null,
        gruppen_preis_total: gruppenMeta.gruppen_preis_total ?? null,
    };
};

/**
 * Resolve which studio location an appointment belongs to. Customers must pick
 * one when the studio runs several; a single-location studio is assigned
 * automatically so existing clients keep working.
 */
const resolveStandortForBooking = async (caseDoc, body, user) => {
    const Studio = require('../models/studioModel');
    const { activeStandorte, findStandort } = require('../utils/studioHours');

    const studio = await Studio.findById(caseDoc.studio).select('standorte').lean();
    const available = activeStandorte(studio);
    const requested = String(body.standort_id ?? '').trim();

    if (requested) {
        const match = findStandort({ standorte: available }, requested);
        if (!match) {
            throw new ApiError(400, 'Unknown standort_id for this studio');
        }
        return { standort_id: String(match._id), standort_name: match.name };
    }

    if (available.length === 1) {
        return {
            standort_id: String(available[0]._id),
            standort_name: available[0].name,
        };
    }

    if (available.length > 1 && isCustomer(user.role)) {
        throw new ApiError(400, 'standort_id is required — please choose a location');
    }

    return { standort_id: '', standort_name: body.standort_name ?? '' };
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

const isTreatmentBooking = (body, fallbackConsultationOnly = false) => {
    const consultationOnly = body.consultationOnly ?? fallbackConsultationOnly;
    const type = body.type;
    return !consultationOnly && type !== APPOINTMENT_TYPE.BERATUNG;
};

const resolvePreSessionForCustomerBooking = async (caseDoc, body, user, { persist = true } = {}) => {
    if (!isCustomer(user.role) || !isTreatmentBooking(body)) {
        return body.preSessionCheck ?? {};
    }

    if (!body.booking_precheck) {
        throw new ApiError(400, 'booking_precheck is required for customer treatment bookings');
    }

    if (persist) {
        const { preSessionCheck } = await applyBookingPrecheckToCase(caseDoc, body.booking_precheck);
        return preSessionCheck;
    }

    const anamnesis = await Anamnesis.findOne({ case: caseDoc._id });
    const { validateBookingPrecheck } = require('../utils/bookingPrecheckEngine');
    const {
        pre_session: preSession = {},
        ko_answers: koAnswers = {},
        wiederholungen = {},
        wiederholungen_confirmed: wiederholungenConfirmed = false,
        ko_signature: koSignature = null,
    } = body.booking_precheck;

    const { getEffectiveSperrfristen } = require('../utils/configService');
    const result = validateBookingPrecheck({
        caseDoc,
        anamnesis,
        consultationOnly: false,
        preSession,
        koAnswers,
        wiederholungen,
        wiederholungenConfirmed,
        koSignature,
        sperrfristen: await getEffectiveSperrfristen(caseDoc.studio),
    });

    if (!result.can_proceed) {
        throw new ApiError(400, 'Booking pre-check failed', { blocks: result.blocks });
    }

    return result.pre_session_check;
};

const createAppointment = asyncHandler(async (req, res) => {
    const { case_id, gruppen_cases, ...body } = req.body;

    const primaryCase = await Case.findById(case_id);
    if (!primaryCase) {
        throw new ApiError(404, 'Case not found');
    }

    assertCaseAccess(req.user, primaryCase);

    const extraGroupIds = Array.isArray(gruppen_cases) ? gruppen_cases : [];
    // The case list decides, not the flag: requiring both meant a payload with
    // gruppen_cases but no gruppen_termin silently booked only the primary case.
    const isGroup = extraGroupIds.length > 0;
    const groupCases = isGroup
        ? await loadCasesForGroup(primaryCase, extraGroupIds, req.user)
        : [primaryCase];

    if (isGroup) {
        const CaseZone = require('../models/caseZoneModel');
        const { getEffectiveGruppenGroessen, getEffectivePricingOverrides } = require('../utils/configService');
        const { validateGroupSelection, calcGroupPricingFromPrices } = require('../utils/groupBooking');
        const { calculatePrice } = require('../utils/pricingEngine');

        const gg = await getEffectiveGruppenGroessen(primaryCase.studio);
        const items = [];
        for (const caseDoc of groupCases) {
            const zones = caseDoc.zonen_aktiv
                ? await CaseZone.find({ case: caseDoc._id }).lean()
                : [];
            items.push({ caseDoc, zones });
        }
        const check = validateGroupSelection(items, gg);
        if (!check.ok) {
            throw new ApiError(400, check.message);
        }

        const prices = [];
        for (const caseDoc of groupCases) {
            const pricingInput = caseDoc.toObject ? caseDoc.toObject() : { ...caseDoc };
            if (caseDoc.zonen_aktiv) {
                pricingInput.zonen = await CaseZone.find({ case: caseDoc._id }).lean();
            }
            const overrides = await getEffectivePricingOverrides(caseDoc.studio);
            prices.push(calculatePrice(pricingInput, overrides).pricePerSession || 0);
        }
        const priced = calcGroupPricingFromPrices(prices, gg);
        body.gruppen_rabatt = gg.gruppen_rabatt;
        body.gruppen_preis_total = priced.gesamt;
    }

    const standort = await resolveStandortForBooking(primaryCase, body, req.user);
    body.standort_id = standort.standort_id;
    body.standort_name = standort.standort_name;

    const { getEffectiveBookingConfig } = require('../utils/configService');
    const { termin_einstellungen } = await getEffectiveBookingConfig(primaryCase.studio);
    const defaultDauer = isGroup
        ? termin_einstellungen.gruppen_dauer_minuten
        : isTreatmentBooking(body)
          ? termin_einstellungen.behandlung_dauer_minuten
          : termin_einstellungen.beratung_dauer_minuten;

    const preSessionCheck = await resolvePreSessionForCustomerBooking(primaryCase, body, req.user);

    for (const caseDoc of groupCases) {
        await assertBookingDateAllowed({
            caseId: caseDoc._id,
            customerId: caseDoc.customer,
            date: body.date,
            time: body.time,
            consultationOnly: !isTreatmentBooking(body),
            preSessionCheck: isTreatmentBooking(body) ? preSessionCheck : {},
            standortId: standort.standort_id || null,
        });
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
                default_dauer_minuten: defaultDauer,
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

    // A new treatment date opens a cross-case blocking period on the customer's
    // other cases, so their app has to recompute every earliest bookable date.
    emitAvailabilityChanged({
        customerId: primaryCase.customer,
        studioId: primaryCase.studio,
        reason: 'appointment_created',
    });

    res.status(201).json({
        success: true,
        message: isGroup ? 'Group appointment booked successfully' : 'Appointment booked successfully',
        data: {
            appointments: appointments.map(formatAppointment),
            booking_precheck_applied: isCustomer(req.user.role) && isTreatmentBooking(body),
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
    const isReschedule = req.body.date && isTreatmentBooking(req.body, appointment.consultationOnly);

    // A customer may also move to another location of the same studio when
    // rescheduling; keep the current one when the request omits it.
    let targetStandort = null;
    if (req.body.standort_id !== undefined) {
        const caseForStandort = await Case.findById(appointment.case).select('studio').lean();
        if (caseForStandort) {
            targetStandort = await resolveStandortForBooking(
                caseForStandort,
                req.body,
                req.user
            );
        }
    }
    const effectiveStandortId = targetStandort
        ? targetStandort.standort_id
        : appointment.standort_id || '';

    if (isReschedule) {
        const caseDoc = await Case.findById(appointment.case);
        if (caseDoc) {
            const preSessionCheck = isCustomer(req.user.role)
                ? await resolvePreSessionForCustomerBooking(caseDoc, req.body, req.user, { persist: false })
                : (req.body.preSessionCheck ?? {});

            await assertBookingDateAllowed({
                caseId: caseDoc._id,
                customerId: caseDoc.customer,
                date: req.body.date,
                time: req.body.time,
                consultationOnly: false,
                preSessionCheck,
                standortId: effectiveStandortId || null,
            });
        }
    }

    const previousDate = appointment.date;
    const previousTime = appointment.time;
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
    if (targetStandort) {
        appointment.standort_id = targetStandort.standort_id;
        appointment.standort_name = targetStandort.standort_name;
    } else if (req.body.standort_name !== undefined) {
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
            await appendCaseActivity(
                caseDoc,
                'cancelled',
                formatApptStamp(appointment.date, appointment.time)
            );
        } else if (req.body.date && new Date(req.body.date).getTime() !== new Date(previousDate).getTime()) {
            await appendCaseActivity(
                caseDoc,
                'rescheduled',
                `${formatApptStamp(previousDate, previousTime)} → ${formatApptStamp(appointment.date, appointment.time)}`
            );
        }
    }

    // Cancelling frees a blocking period, rescheduling moves it — either way the
    // earliest bookable date of every case of this customer can change.
    if (isNowCancelled || dateChanged || req.body.status !== undefined) {
        emitAvailabilityChanged({
            customerId: appointment.customer,
            studioId: appointment.studio,
            reason: isNowCancelled ? 'appointment_cancelled' : 'appointment_updated',
        });
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

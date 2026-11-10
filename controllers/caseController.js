const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const Customer = require('../models/customerModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const Anamnesis = require('../models/anamnesisModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { generateCaseId } = require('../utils/generateCaseId');
const { assertCaseAccess, assertCaseWriteAccess, buildStudioSharedFilter, refId } = require('../utils/accessHelpers');
const {
    computeAvailability,
    parsePreSessionCheck,
} = require('../utils/lockoutEngine');
const {
    calculateCasePreview,
    formatCustomerPreview,
} = require('../utils/pricingEngine');
const { getEffectivePricingOverrides } = require('../utils/configService');
const { isFeatureEnabled } = require('../utils/featureService');
const {
    USER_ROLES,
    CASE_TYPE,
    CASE_STATUS,
    ESTIMATE_CONFIRMATION_STATUS,
} = require('../config/constants');
const messagingService = require('../services/messagingService');
const { emitMessageCreated } = require('../sockets/emitHelpers');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const {
    syncCustomerPlatformCrmSafe,
} = require('../utils/platformFunnelEngine');
const {
    CUSTOMER_INTAKE_FIELDS,
    CARRY_OVER_INTAKE_FIELDS,
    syncDerivedIntakeFields,
} = require('../utils/caseIntakeHelpers');
const {
    formatSessionForecastFields,
    resolveBaselinePhotoFileId,
} = require('../utils/sessionForecastFromProgress');
const {
    linkCaseIntakeFiles,
    linkZonePhotoFiles,
} = require('../services/fileAccessService');

const STUDIO_ROLES = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

const isCustomer = (role) => role === USER_ROLES.CUSTOMER;
const isStudio = (role) => STUDIO_ROLES.includes(role);
const isAdmin = (role) => ADMIN_ROLES.includes(role);

const INTAKE_RESPONSE_FIELDS = [
    'tc_body_location_main',
    'tc_body_location_detail',
    'tc_side',
    'tc_age_bucket',
    'tc_prior_treatment',
    'tc_prior_treatment_count',
    'tc_prior_last_treatment_date',
    'tc_prior_studio',
    'elaya_tracking_started_at',
    'tc_density',
    'tc_saturation',
    'tc_shading',
    'tc_linework',
    'tc_depth',
    'skin_fitzpatrick_type',
    'skin_hyperpig_risk',
    'skin_keloid_risk',
    'skin_sun_zone',
    'life_smoker',
    'life_cig_per_day',
    'life_alcohol',
    'life_activity',
    'life_sport_freq',
    'life_sleep_hours',
    'life_sleep_quality',
    'life_stress',
    'life_height_cm',
    'life_weight_kg',
    'life_hydration',
    'life_nutrition',
    'life_aftercare_commitment',
    'goal_notes',
    'pmu_type',
    'pmu_side',
    'pmu_age_range',
    'pmu_technique',
    'pigment_type',
    'stitch_depth',
    'previously_lasered',
    'lasered_notes',
    'colors',
    'color_density',
    'color_saturation',
    'has_shading',
    'has_linework',
    'paradox_darkening_acknowledged',
    'photo_intake_main',
    'photo_intake_detail',
    'photo_marker',
    'photo_std_intake',
    'unterschrift',
];

const formatCustomerRef = (customer) => {
    if (!customer) {
        return null;
    }

    if (typeof customer === 'object' && (customer.vorname !== undefined || customer.email !== undefined)) {
        return {
            id: customer._id?.toString() ?? customer.id,
            vorname: customer.vorname ?? '',
            nachname: customer.nachname ?? '',
            email: customer.email ?? '',
            telefon: customer.telefon ?? '',
        };
    }

    return customer.toString();
};

const formatEstimateConfirmation = (confirmation, role) => {
    const c = confirmation?.toObject?.() ?? confirmation ?? {};
    const payload = {
        status: c.status ?? ESTIMATE_CONFIRMATION_STATUS.OFFEN,
        pricePerSession: c.pricePerSession ?? null,
        sessionsMin: c.sessionsMin ?? null,
        sessionsMax: c.sessionsMax ?? null,
        notiz: c.notiz ?? '',
        datum: c.datum ?? null,
    };
    if (!isCustomer(role)) {
        payload.bestaetigt_von = c.bestaetigt_von ?? '';
        payload.bestaetigt_von_id = c.bestaetigt_von_id ?? null;
    }
    return payload;
};

const formatCase = (caseDoc, zones, role, options = {}) => {
    const doc = caseDoc.toObject ? caseDoc.toObject() : { ...caseDoc };
    const prices = resolveDisplayedPrices(doc);
    const forecast = formatSessionForecastFields(doc);
    const payload = {
        id: doc._id,
        caseId: doc.caseId,
        customer: formatCustomerRef(doc.customer),
        studio: doc.studio,
        type: doc.type,
        tc_title: doc.tc_title,
        bodyLabel: doc.bodyLabel,
        tc_colors_present: doc.tc_colors_present,
        tc_size_length: doc.tc_size_length,
        tc_size_width: doc.tc_size_width,
        tc_type: doc.tc_type,
        tc_age_years: doc.tc_age_years,
        skin_fitzpatrick: doc.skin_fitzpatrick,
        tc_coverup: doc.tc_coverup,
        goal_target: doc.goal_target,
        sessions: doc.sessions,
        sessionsMin: doc.sessionsMin,
        sessionsMax: doc.sessionsMax,
        sessionsDone: doc.sessionsDone,
        elaya_sessions_done: doc.sessionsDone ?? 0,
        prior_treatments_before_elaya:
            doc.tc_prior_treatment === true ? doc.tc_prior_treatment_count ?? 0 : 0,
        removal: doc.removal,
        healing: doc.healing,
        status: doc.status,
        original_sessionsMin: forecast.original_sessionsMin,
        original_sessionsMax: forecast.original_sessionsMax,
        current_sessionsMin: forecast.current_sessionsMin,
        current_sessionsMax: forecast.current_sessionsMax,
        remaining_sessionsMin: forecast.remaining_sessionsMin,
        remaining_sessionsMax: forecast.remaining_sessionsMax,
        sessions_forecast_updated_at: forecast.sessions_forecast_updated_at,
        sessions_forecast_meta: forecast.sessions_forecast_meta,
        baseline_photo_file_id: resolveBaselinePhotoFileId(doc, zones || []),
        medical_flag_level: doc.medical_flag_level,
        open_medical_flags_count: doc.open_medical_flags_count ?? 0,
        anamnesis_complete: doc.anamnesis_complete ?? false,
        signature_complete: !!doc.unterschrift?.zeitstempel,
        anamnesis_signature_complete: !!doc.unterschrift_anamnese?.zeitstempel,
        lastSessionDate: doc.lastSessionDate,
        akquise_quelle: doc.akquise_quelle,
        zonen_aktiv: doc.zonen_aktiv,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };

    if (options.viewerStudioId && refId(doc.studio) !== refId(options.viewerStudioId)) {
        payload.transferiert = true;
        payload.herkunft_studio_id = refId(doc.studio);
    } else {
        payload.transferiert = false;
    }

    INTAKE_RESPONSE_FIELDS.forEach((field) => {
        payload[field] = doc[field];
    });

    if (payload.unterschrift?.unterschrift_data) {
        const { zeitstempel, merkblatt_gelesen, bestaetigung_text } = payload.unterschrift;
        payload.unterschrift = { zeitstempel, merkblatt_gelesen, bestaetigung_text };
        payload.signature_image_url = `/cases/${doc._id}/signature/image`;
    }

    if (doc.unterschrift_anamnese?.unterschrift_data) {
        const { zeitstempel, anamnese_bestaetigt, bestaetigung_text } =
            doc.unterschrift_anamnese;
        payload.unterschrift_anamnese = {
            zeitstempel,
            anamnese_bestaetigt,
            bestaetigung_text,
        };
        payload.anamnesis_signature_image_url = `/cases/${doc._id}/signature/image?variant=anamnese`;
    }

    payload.pricePerSession = prices.pricePerSession;
    payload.calculated_pricePerSession = prices.calculated_pricePerSession;
    payload.calculated_sessionsMin = prices.calculated_sessionsMin;
    payload.calculated_sessionsMax = prices.calculated_sessionsMax;
    payload.confirmed_pricePerSession = prices.confirmed_pricePerSession;
    payload.confirmed_sessionsMin = prices.confirmed_sessionsMin;
    payload.confirmed_sessionsMax = prices.confirmed_sessionsMax;
    payload.estimate_confirmation = formatEstimateConfirmation(doc.estimate_confirmation, role);

    if (!isCustomer(role)) {
        payload.estimate_needs_review = !!doc.estimate_needs_review;
        payload.estimate_review_triggers = doc.estimate_review_triggers || [];
        payload.uvBlockDate = doc.uvBlockDate;
        payload.medicationBlockDate = doc.medicationBlockDate;
        payload.sperrfrist_deaktiviert = doc.sperrfrist_deaktiviert;
        payload.merkblatt_pdf = doc.merkblatt_pdf;
        payload.studio_freigabe = doc.studio_freigabe;
    } else if (doc.studio_freigabe) {
        payload.studio_freigabe = {
            erforderlich: doc.studio_freigabe.erforderlich,
            status: doc.studio_freigabe.status,
        };
    }

    if (isAdmin(role) || isStudio(role)) {
        payload.activityLog = doc.activityLog;
    }

    if (zones) {
        payload.zonen = zones.map((z) => {
            const zone = z.toObject ? z.toObject() : z;
            const formatted = {
                id: zone._id,
                zonen_id: zone.zonen_id,
                bezeichnung: zone.bezeichnung,
                koerperstelle: zone.koerperstelle,
                farben: zone.farben,
                dichte: zone.dichte,
                laenge_cm: zone.laenge_cm,
                breite_cm: zone.breite_cm,
                flaeche_cm2: zone.flaeche_cm2,
                foto_url: zone.foto_url,
                fortschritt_prozent: zone.fortschritt_prozent,
                
                sitzungen_erledigt: zone.sitzungen_erledigt ?? 0,
                letzte_sitzung: zone.letzte_sitzung ?? null,
                
                preis: zone.preis,
                sitzungen_geschaetzt_min: zone.sitzungen_geschaetzt_min,
                sitzungen_geschaetzt_max: zone.sitzungen_geschaetzt_max,
            };
            if (!isCustomer(role)) {
                formatted.sperrfrist_bis = zone.sperrfrist_bis;
            }
            return formatted;
        });
    }

    return payload;
};

const resolveCustomerForCreate = async (user, bodyCustomerId) => {
    if (isCustomer(user.role)) {
        const customer = await Customer.findById(user.customer_id);
        if (!customer) {
            throw new ApiError(404, 'Customer profile not found');
        }
        return customer;
    }

    if (isStudio(user.role)) {
        if (!bodyCustomerId) {
            throw new ApiError(400, 'customer_id is required for studio case creation');
        }
        const customer = await Customer.findById(bodyCustomerId);
        if (!customer) {
            throw new ApiError(404, 'Customer not found');
        }
        if (customer.aktuelle_firma_id.toString() !== user.studio_id.toString()) {
            throw new ApiError(403, 'Customer is not assigned to your studio');
        }
        return customer;
    }

    if (isAdmin(user.role)) {
        if (!bodyCustomerId) {
            throw new ApiError(400, 'customer_id is required');
        }
        const customer = await Customer.findById(bodyCustomerId);
        if (!customer) {
            throw new ApiError(404, 'Customer not found');
        }
        return customer;
    }

    throw new ApiError(403, 'You do not have permission to create cases');
};

const zoneAreaCm2 = (zone) => {
    const length = Number(zone.laenge_cm);
    const width = Number(zone.breite_cm);
    if (!(length > 0) || !(width > 0)) return null;
    return Math.round(length * width * 10) / 10;
};

const normalizeZoneInput = (zonenInput) =>
    zonenInput.map((zone, index) => ({
        ...zone,
        zonen_id: zone.zonen_id || `Z${String(index + 1).padStart(3, '0')}`,
        flaeche_cm2: zoneAreaCm2(zone),
    }));

const buildZoneDocs = (caseId, zonenInput) => {
    if (!zonenInput.length) {
        return [];
    }

    return normalizeZoneInput(zonenInput).map((zone) => ({
        case: caseId,
        zonen_id: zone.zonen_id,
        bezeichnung: zone.bezeichnung,
        koerperstelle: zone.koerperstelle,
        farben: zone.farben,
        dichte: zone.dichte ?? null,
        laenge_cm: zone.laenge_cm ?? null,
        breite_cm: zone.breite_cm ?? null,
        flaeche_cm2: zone.flaeche_cm2,
        foto_url: zone.foto_url,
    }));
};

const syncCaseZones = async (caseDoc, zonenInput, user, req) => {
    if (zonenInput === undefined) {
        return [];
    }

    if (!zonenInput.length) {
        await CaseZone.deleteMany({ case: caseDoc._id });
        return [];
    }

    const normalized = normalizeZoneInput(zonenInput);
    const existing = await CaseZone.find({ case: caseDoc._id }).lean();
    const photoByZoneId = new Map(
        existing.filter((z) => z.foto_url).map((z) => [z.zonen_id, z.foto_url])
    );
    const withPhotos = normalized.map((zone) => ({
        ...zone,
        foto_url: zone.foto_url || photoByZoneId.get(zone.zonen_id) || '',
    }));

    const linked = await linkZonePhotoFiles(caseDoc, withPhotos, user, req);

    await CaseZone.deleteMany({ case: caseDoc._id });
    return CaseZone.insertMany(buildZoneDocs(caseDoc._id, linked));
};

const ESTIMATE_RELEVANT_FIELDS = [
    'type',
    'tc_colors_present',
    'tc_size_length',
    'tc_size_width',
    'tc_type',
    'tc_age_bucket',
    'tc_age_years',
    'tc_density',
    'tc_saturation',
    'tc_shading',
    'tc_linework',
    'tc_depth',
    'tc_body_location_main',
    'tc_coverup',
    'tc_prior_treatment',
    'tc_prior_treatment_count',
    'tc_prior_last_treatment_date',
    'tc_prior_studio',
    'skin_fitzpatrick',
    'skin_fitzpatrick_type',
    'skin_sun_zone',
    'life_smoker',
    'life_alcohol',
    'life_cig_per_day',
    'life_sleep_hours',
    'life_sleep_quality',
    'life_stress',
    'life_activity',
    'life_sport_freq',
    'life_height_cm',
    'life_weight_kg',
    'life_hydration',
    'life_nutrition',
    'life_aftercare_commitment',
    'skin_keloid_risk',
    'goal_target',
    'zonen_aktiv',
    'zonen',
    'pmu_type',
    'pigment_type',
    'stitch_depth',
    'previously_lasered',
    'photo_intake_main',
    'photo_intake_detail',
    'photo_marker',
    'photo_std_intake',
];

const ESTIMATE_OUTPUT_FIELDS = ['sessions', 'sessionsMin', 'sessionsMax', 'pricePerSession'];

const isEstimateConfirmed = (caseDoc) =>
    [
        ESTIMATE_CONFIRMATION_STATUS.BESTAETIGT,
        ESTIMATE_CONFIRMATION_STATUS.ANGEPASST,
    ].includes(caseDoc.estimate_confirmation?.status);

const applyCalculatedPreview = (caseDoc, preview) => {
    const price = preview.pricePerSession ?? 0;
    const min = preview.sessions?.min ?? 0;
    const max = preview.sessions?.max ?? 0;
    const base = preview.sessions?.base ?? max;

    caseDoc.calculated_pricePerSession = price;
    caseDoc.calculated_sessionsMin = min;
    caseDoc.calculated_sessionsMax = max;
    caseDoc.estimate_needs_review = Boolean(preview.needs_human_review);
    caseDoc.estimate_review_triggers = preview.review_triggers || [];

    if (!isEstimateConfirmed(caseDoc)) {
        caseDoc.pricePerSession = price;
        caseDoc.sessions = base;
        caseDoc.sessionsMin = min;
        caseDoc.sessionsMax = max;
    }
};

const resolveDisplayedPrices = (doc) => {
    const confirmed = isEstimateConfirmed(doc);
    const calculatedPrice =
        doc.calculated_pricePerSession > 0
            ? doc.calculated_pricePerSession
            : confirmed
              ? null
              : (doc.pricePerSession ?? null);
    const confirmedPrice = confirmed
        ? (doc.estimate_confirmation?.pricePerSession ?? doc.pricePerSession ?? null)
        : null;

    return {
        calculated_pricePerSession: calculatedPrice,
        calculated_sessionsMin:
            doc.calculated_sessionsMin > 0
                ? doc.calculated_sessionsMin
                : confirmed
                  ? null
                  : (doc.sessionsMin ?? null),
        calculated_sessionsMax:
            doc.calculated_sessionsMax > 0
                ? doc.calculated_sessionsMax
                : confirmed
                  ? null
                  : (doc.sessionsMax ?? null),
        confirmed_pricePerSession: confirmedPrice,
        confirmed_sessionsMin: confirmed
            ? (doc.estimate_confirmation?.sessionsMin ?? doc.sessionsMin ?? null)
            : null,
        confirmed_sessionsMax: confirmed
            ? (doc.estimate_confirmation?.sessionsMax ?? doc.sessionsMax ?? null)
            : null,
        pricePerSession: confirmedPrice ?? calculatedPrice ?? doc.pricePerSession ?? null,
    };
};

const touchesEstimateInput = (body) =>
    ESTIMATE_RELEVANT_FIELDS.some((field) => body[field] !== undefined) ||
    ESTIMATE_OUTPUT_FIELDS.some((field) => body[field] !== undefined);

const refreshCaseEstimate = async (caseDoc, zoneDocs = null) => {
    const pricingInput = caseDoc.toObject ? caseDoc.toObject() : { ...caseDoc };

    let zones = null;
    if (caseDoc.zonen_aktiv) {
        zones =
            zoneDocs ??
            (await CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 }).lean());
        pricingInput.zonen = zones.map((z) => (z.toObject ? z.toObject() : z));
    }

    const pricingOverrides = await getEffectivePricingOverrides(caseDoc.studio);
    const preview = calculateCasePreview(pricingInput, pricingOverrides);
    applyCalculatedPreview(caseDoc, preview);
    await caseDoc.save();

    if (zones?.length && Array.isArray(preview.zonen)) {
        await Promise.all(
            zones.map((zone, index) => {
                const row = preview.zonen[index];
                if (!row) return null;
                return CaseZone.updateOne(
                    { _id: zone._id },
                    {
                        $set: {
                            preis: row.preis ?? 0,
                            sitzungen_geschaetzt_min: row.sessions?.min ?? 0,
                            sitzungen_geschaetzt_max: row.sessions?.max ?? 0,
                        },
                    }
                );
            })
        );
        return CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 }).lean();
    }

    return zones;
};

const applyCaseUpdate = async (caseDoc, body, user, req) => {
    const { zonen, ...fields } = body;
    const normalized = syncDerivedIntakeFields(fields);

    Object.assign(caseDoc, normalized);

    if (normalized.unterschrift) {
        caseDoc.unterschrift = {
            ...(caseDoc.unterschrift?.toObject?.() ?? caseDoc.unterschrift ?? {}),
            ...normalized.unterschrift,
        };
        caseDoc.markModified('unterschrift');
    }

    if (normalized.photo_std_intake) {
        caseDoc.photo_std_intake = {
            ...(caseDoc.photo_std_intake?.toObject?.() ?? caseDoc.photo_std_intake ?? {}),
            ...normalized.photo_std_intake,
        };
        caseDoc.markModified('photo_std_intake');
    }

    await caseDoc.save();

    return syncCaseZones(caseDoc, zonen, user, req);
};

const createCase = asyncHandler(async (req, res) => {
    const { customer_id, zonen = [], ...rawFields } = req.body;
    const caseFields = syncDerivedIntakeFields(rawFields);

    const customer = await resolveCustomerForCreate(req.user, customer_id);
    const studioId = customer.aktuelle_firma_id;

    const existingCaseIds = await Case.find({ studio: studioId }).distinct('caseId');
    const title = caseFields.tc_title || caseFields.bodyLabel || 'Case';
    const caseId = generateCaseId(title, existingCaseIds);

    if (caseFields.zonen_aktiv && zonen.length > 0 && (zonen.length < 2 || zonen.length > 8)) {
        throw new ApiError(400, 'Zone mode requires between 2 and 8 zones');
    }
    if (caseFields.zonen_aktiv) {
        const zonenOk = await isFeatureEnabled(studioId, 'case_zonen');
        if (!zonenOk) {
            throw new ApiError(403, 'Feature case_zonen is disabled for this studio');
        }
    }

    let caseDoc = null;
    let zoneDocs = [];

    try {
        caseDoc = await Case.create({
            ...caseFields,
            customer: customer._id,
            studio: studioId,
            caseId,
            akquise_quelle: caseFields.akquise_quelle ?? customer.akquise_quelle,
            elaya_tracking_started_at: caseFields.elaya_tracking_started_at || new Date(),
        });

        const linkedPhotos = await linkCaseIntakeFiles(
            caseDoc,
            {
                photo_intake_main: caseFields.photo_intake_main,
                photo_intake_detail: caseFields.photo_intake_detail,
                photo_marker: caseFields.photo_marker,
            },
            req.user,
            req
        );

        if (Object.keys(linkedPhotos).length > 0) {
            Object.assign(caseDoc, linkedPhotos);
            await caseDoc.save();
        }

        if (zonen.length > 0) {
            const linkedZones = await linkZonePhotoFiles(
                caseDoc,
                normalizeZoneInput(zonen),
                req.user,
                req
            );
            zoneDocs = await CaseZone.insertMany(buildZoneDocs(caseDoc._id, linkedZones));
        }

        zoneDocs = (await refreshCaseEstimate(caseDoc, zoneDocs)) ?? zoneDocs;
    } catch (error) {
        if (caseDoc?._id) {
            await CaseZone.deleteMany({ case: caseDoc._id });
            await Case.deleteOne({ _id: caseDoc._id });
        }
        throw error;
    }

    await syncCustomerPlatformCrmSafe(customer._id);

    res.status(201).json({
        success: true,
        message: 'Case created successfully',
        data: {
            case: formatCase(caseDoc, zoneDocs, req.user.role),
        },
    });
});

const PREFILL_LOOKBACK_CASES = 10;


const getCaseIntakePrefill = asyncHandler(async (req, res) => {
    let customerId;

    if (isCustomer(req.user.role)) {
        customerId = req.user.customer_id;
    } else if (isStudio(req.user.role) || isAdmin(req.user.role)) {
        customerId = req.query.customer_id;
        if (!customerId) {
            throw new ApiError(400, 'customer_id is required');
        }
    } else {
        throw new ApiError(403, 'You do not have permission to read intake prefill');
    }

    const filter = { customer: customerId };

    if (req.query.exclude_case_id) {
        filter._id = { $ne: req.query.exclude_case_id };
    }

    if (isStudio(req.user.role)) {
        filter.studio = req.user.studio_id;
    }

    const recentCases = await Case.find(filter)
        .sort({ createdAt: -1 })
        .limit(PREFILL_LOOKBACK_CASES)
        .select(
            [
                ...CARRY_OVER_INTAKE_FIELDS,
                'caseId',
                'tc_title',
                'bodyLabel',
                'type',
                'createdAt',
                'unterschrift',
            ].join(' ')
        )
        .lean();

    const fields = {};
    let source = null;

    for (const candidate of recentCases) {
        for (const field of CARRY_OVER_INTAKE_FIELDS) {
            const value = candidate[field];
            if (value === null || value === undefined) continue;
            if (!(field in fields)) {
                fields[field] = value;
                source = source ?? candidate;
            }
        }
    }

    if (!source) {
        res.status(200).json({
            success: true,
            data: { available: false, source: null, fields: {} },
        });
        return;
    }

    res.status(200).json({
        success: true,
        data: {
            available: Object.keys(fields).length > 0,
            source: {
                case_id: String(source._id),
                caseId: source.caseId ?? '',
                tc_title: source.tc_title ?? '',
                bodyLabel: source.bodyLabel ?? '',
                type: source.type,
                created_at: source.createdAt,
                signed_at: source.unterschrift?.zeitstempel ?? null,
            },
            fields,
        },
    });
});

const listCases = asyncHandler(async (req, res) => {
    let filter = {};
    const viewerStudioId = isStudio(req.user.role) ? req.user.studio_id : null;

    if (isCustomer(req.user.role)) {
        filter.customer = req.user.customer_id;
    } else if (isStudio(req.user.role)) {
        if (req.query.customer_id) {
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
    } else if (isAdmin(req.user.role)) {
        if (req.query.customer_id) {
            filter.customer = req.query.customer_id;
        }
        if (req.query.studio_id) {
            filter.studio = req.query.studio_id;
        }
    } else {
        throw new ApiError(403, 'You do not have permission to list cases');
    }

    if (req.query.status) {
        filter.status = req.query.status;
    } else if (isStudio(req.user.role) && !req.query.include_draft) {
        filter.status = { $ne: 'draft' };
    }

    if (req.query.medical_flag) {
        filter.medical_flag_level = req.query.medical_flag;
    }

    const { page, limit, skip } = parsePagination(req.query);

    const [cases, total] = await Promise.all([
        Case.find(filter)
            .populate('customer', 'vorname nachname email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Case.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            cases: cases.map((c) =>
                formatCase(c, null, req.user.role, { viewerStudioId })
            ),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const getCase = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id).populate(
        'customer',
        'vorname nachname email telefon'
    );

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    const access = await assertCaseAccess(req.user, caseDoc);

    let zones = caseDoc.zonen_aktiv
        ? await CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 })
        : [];

    const viewerStudioId = isStudio(req.user.role) ? req.user.studio_id : null;
    if (!(caseDoc.calculated_pricePerSession > 0)) {
        try {
            zones = (await refreshCaseEstimate(caseDoc, zones)) ?? zones;
        } catch (error) {
            console.error('Calculated estimate snapshot failed:', error.message);
        }
    }
    const formatted = formatCase(caseDoc, zones, req.user.role, { viewerStudioId });
    if (access.transferiert) formatted.transferiert = true;
    if (access.read_only) formatted.read_only = true;

    let medical_clearance = null;
    try {
        const { serializeClearance } = require('../utils/medicalClearanceService');
        const Customer = require('../models/customerModel');
        const custId = caseDoc.customer?._id || caseDoc.customer;
        const cust = await Customer.findById(custId).select('medical_clearance').lean();
        medical_clearance = serializeClearance(cust?.medical_clearance);
    } catch (err) {
        console.error('Case medical_clearance attach failed:', err.message);
    }

    res.status(200).json({
        success: true,
        data: {
            case: formatted,
            medical_clearance,
        },
    });
});

const updateCase = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseWriteAccess(req.user, caseDoc);

    if (isCustomer(req.user.role)) {
        const allowed = new Set(CUSTOMER_INTAKE_FIELDS);
        const blocked = Object.keys(req.body).filter((key) => !allowed.has(key));
        if (blocked.length > 0) {
            throw new ApiError(403, `Customers cannot update: ${blocked.join(', ')}`);
        }
    }

    const touchedEstimate = touchesEstimateInput(req.body);
    ESTIMATE_OUTPUT_FIELDS.forEach((field) => {
        delete req.body[field];
    });

    if (
        req.body.zonen_aktiv &&
        req.body.zonen?.length > 0 &&
        (req.body.zonen.length < 2 || req.body.zonen.length > 8)
    ) {
        throw new ApiError(400, 'Zone mode requires between 2 and 8 zones');
    }
    if (req.body.zonen_aktiv) {
        const zonenOk = await isFeatureEnabled(caseDoc.studio, 'case_zonen');
        if (!zonenOk) {
            throw new ApiError(403, 'Feature case_zonen is disabled for this studio');
        }
    }

    let zoneDocs = await applyCaseUpdate(caseDoc, req.body, req.user, req);

    if (touchedEstimate) {
        const refreshed = await refreshCaseEstimate(
            caseDoc,
            req.body.zonen !== undefined ? zoneDocs : null
        );
        if (refreshed?.length) zoneDocs = refreshed;
    }

    await caseDoc.populate('customer', 'vorname nachname email telefon');

    await syncCustomerPlatformCrmSafe(caseDoc.customer?._id || caseDoc.customer);

    const zones =
        zoneDocs.length > 0 || req.body.zonen !== undefined
            ? zoneDocs
            : caseDoc.zonen_aktiv
              ? await CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 })
              : [];

    res.status(200).json({
        success: true,
        message: 'Case updated successfully',
        data: {
            case: formatCase(caseDoc, zones, req.user.role),
        },
    });
});

const deleteIncompleteCase = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseWriteAccess(req.user, caseDoc);

    const studioTestDeleteEnabled = process.env.TEST_CASE_DELETE_ENABLED !== 'false';
    const studioHardDeleteAllowed =
        studioTestDeleteEnabled &&
        (req.user.role === USER_ROLES.STUDIO_ADMIN ||
            req.user.role === USER_ROLES.STUDIO_STAFF);

    if (!studioHardDeleteAllowed) {
        if (caseDoc.unterschrift?.zeitstempel) {
            throw new ApiError(400, 'Signed cases cannot be deleted from the app');
        }

        const deletable =
            caseDoc.status === CASE_STATUS.DRAFT ||
            caseDoc.status === CASE_STATUS.PENDING;

        if (!deletable) {
            throw new ApiError(400, 'Only incomplete draft/pending cases can be deleted');
        }
    }

    const customerId = caseDoc.customer;

    await CaseZone.deleteMany({ case: caseDoc._id });
    await Session.deleteMany({ case: caseDoc._id });
    await Appointment.deleteMany({ case: caseDoc._id });
    await Anamnesis.deleteMany({ case: caseDoc._id });
    await Case.deleteOne({ _id: caseDoc._id });

    await syncCustomerPlatformCrmSafe(customerId);

    res.status(200).json({
        success: true,
        message: 'Incomplete case deleted',
        data: { id: caseDoc._id.toString() },
    });
});

const getCaseAvailability = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseAccess(req.user, caseDoc);

    const { consultationOnly, from, to, standort_id, ...preSessionInput } = req.query;

    const result = await computeAvailability({
        activeCaseId: caseDoc._id,
        customerId: caseDoc.customer,
        consultationOnly: consultationOnly ?? false,
        preSessionCheck: parsePreSessionCheck(preSessionInput),
        from,
        to,
        standortId: standort_id || null,
    });

    res.status(200).json({
        success: true,
        data: result,
    });
});

const getCaseStandorte = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseAccess(req.user, caseDoc);

    const Studio = require('../models/studioModel');
    const {
        activeStandorte,
        resolveStandortSchedule,
        roomsForStandort,
        staffForStandort,
    } = require('../utils/studioHours');
    const { APPOINTMENT_STATUS } = require('../config/constants');

    const studio = await Studio.findById(caseDoc.studio)
        .select(
            'firma standorte strasse plz ort land behandlungsraeume mitarbeiter oeffnungszeiten oeffnungs_ausnahmen pufferzeit_minuten slot_interval_minuten'
        )
        .lean();

    if (!studio) {
        throw new ApiError(404, 'Studio not found');
    }

    const [lastAppointment, lastSession] = await Promise.all([
        Appointment.findOne({
            customer: caseDoc.customer,
            studio: studio._id,
            status: { $nin: [APPOINTMENT_STATUS.STORNIERT, APPOINTMENT_STATUS.CANCELLED] },
            standort_id: { $nin: ['', null] },
        })
            .sort({ date: -1 })
            .select('standort_id standort_name date')
            .lean(),
        Session.findOne({
            customer: caseDoc.customer,
            studio: studio._id,
            standort_id: { $nin: ['', null] },
        })
            .sort({ treatment_date: -1 })
            .select('standort_id standort_name treatment_date')
            .lean(),
    ]);

    const lastBookedId = lastAppointment?.standort_id || '';
    const lastTreatedId = lastSession?.standort_id || '';
    const lastUsedId =
        lastBookedId && lastTreatedId
            ? new Date(lastSession.treatment_date) > new Date(lastAppointment.date)
                ? lastTreatedId
                : lastBookedId
            : lastBookedId || lastTreatedId;

    const standorte = activeStandorte(studio).map((standort) => {
        const id = String(standort._id);
        const schedule = resolveStandortSchedule(studio, id);
        return {
            id,
            name: standort.name,
            strasse: standort.strasse ?? '',
            plz: standort.plz ?? '',
            ort: standort.ort ?? '',
            land: standort.land ?? 'Schweiz',
            ist_zuletzt_genutzt: id === lastUsedId,
            ist_zuletzt_gebucht: id === lastBookedId,
            ist_zuletzt_behandelt: id === lastTreatedId,
            raeume_anzahl: roomsForStandort(studio, id).length,
            mitarbeiter_anzahl: staffForStandort(studio, id).length,
            slot_interval_minuten: Number(schedule.slot_interval_minuten) || 60,
        };
    });

    res.status(200).json({
        success: true,
        data: {
            studio: {
                id: String(studio._id),
                firma: studio.firma,
                strasse: studio.strasse ?? '',
                plz: studio.plz ?? '',
                ort: studio.ort ?? '',
            },
            standorte,
            auswahl_erforderlich: standorte.length > 1,
            last_used_standort_id: lastUsedId,
            last_booked_standort_id: lastBookedId,
            last_booked_standort_name: lastAppointment?.standort_name || '',
            last_treated_standort_id: lastTreatedId,
            last_treated_standort_name: lastSession?.standort_name || '',
        },
    });
});

const getCasePricing = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseAccess(req.user, caseDoc);

    const pricingInput = caseDoc.toObject ? caseDoc.toObject() : { ...caseDoc };

    if (caseDoc.zonen_aktiv) {
        const zones = await CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 }).lean();
        pricingInput.zonen = zones;
    }

    const pricingOverrides = await getEffectivePricingOverrides(caseDoc.studio);
    const result = calculateCasePreview(pricingInput, pricingOverrides);
    const payload = isCustomer(req.user.role)
        ? formatCustomerPreview(result)
        : result;

    payload.estimate_confirmation = formatEstimateConfirmation(
        caseDoc.estimate_confirmation,
        req.user.role
    );
    const prices = resolveDisplayedPrices(caseDoc);
    payload.persisted = {
        pricePerSession: prices.pricePerSession,
        sessionsMin: caseDoc.sessionsMin,
        sessionsMax: caseDoc.sessionsMax,
        calculated_pricePerSession: prices.calculated_pricePerSession,
        confirmed_pricePerSession: prices.confirmed_pricePerSession,
    };

    res.status(200).json({
        success: true,
        data: payload,
    });
});

const updateEstimateConfirmation = asyncHandler(async (req, res) => {
    if (isCustomer(req.user.role)) {
        throw new ApiError(403, 'Only studio staff or admin can confirm estimates');
    }

    const caseDoc = await Case.findById(req.params.id);
    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseWriteAccess(req.user, caseDoc);

    const { status, pricePerSession, sessionsMin, sessionsMax, notiz = '' } = req.body;
    const now = new Date();
    const label = req.user?.email || 'Studio';

    if (status === ESTIMATE_CONFIRMATION_STATUS.OFFEN) {
        caseDoc.estimate_confirmation = {
            status: ESTIMATE_CONFIRMATION_STATUS.OFFEN,
            pricePerSession: null,
            sessionsMin: null,
            sessionsMax: null,
            notiz,
            datum: now,
            bestaetigt_von: label,
            bestaetigt_von_id: req.user._id,
        };
        caseDoc.markModified('estimate_confirmation');
        caseDoc.activityLog.push({
            type: 'estimate_confirmation',
            ts: now,
            details: `Kostenschätzung wieder geöffnet · ${label}`,
        });
        await caseDoc.save();
        await refreshCaseEstimate(caseDoc);
        require('../utils/openActionService').publishOpenActionsChanged(caseDoc.studio);

        return res.status(200).json({
            success: true,
            message: 'Estimate confirmation reset',
            data: {
                estimate_confirmation: formatEstimateConfirmation(
                    caseDoc.estimate_confirmation,
                    req.user.role
                ),
                ...resolveDisplayedPrices(caseDoc),
                sessionsMin: caseDoc.sessionsMin,
                sessionsMax: caseDoc.sessionsMax,
            },
        });
    }

    const confirmedPrice =
        pricePerSession != null ? pricePerSession : caseDoc.pricePerSession;
    const confirmedMin = sessionsMin != null ? sessionsMin : caseDoc.sessionsMin;
    const confirmedMax = sessionsMax != null ? sessionsMax : caseDoc.sessionsMax;

    if (!(confirmedPrice > 0) || !(confirmedMax > 0)) {
        throw new ApiError(
            400,
            'No estimate to confirm yet — provide pricePerSession and session range'
        );
    }
    if (confirmedMin > confirmedMax) {
        throw new ApiError(400, 'sessionsMin must not exceed sessionsMax');
    }

    if (!(caseDoc.calculated_pricePerSession > 0)) {
        caseDoc.calculated_pricePerSession = caseDoc.pricePerSession ?? 0;
        caseDoc.calculated_sessionsMin = caseDoc.sessionsMin ?? 0;
        caseDoc.calculated_sessionsMax = caseDoc.sessionsMax ?? 0;
    }

    caseDoc.estimate_confirmation = {
        status,
        pricePerSession: confirmedPrice,
        sessionsMin: confirmedMin,
        sessionsMax: confirmedMax,
        notiz,
        datum: now,
        bestaetigt_von: label,
        bestaetigt_von_id: req.user._id,
    };
    caseDoc.markModified('estimate_confirmation');

    caseDoc.pricePerSession = confirmedPrice;
    caseDoc.sessionsMin = confirmedMin;
    caseDoc.sessionsMax = confirmedMax;
    caseDoc.sessions = confirmedMax;
    caseDoc.estimate_needs_review = false;
    caseDoc.estimate_review_triggers = [];

    const verb =
        status === ESTIMATE_CONFIRMATION_STATUS.ANGEPASST ? 'angepasst' : 'bestätigt';
    caseDoc.activityLog.push({
        type: 'estimate_confirmation',
        ts: now,
        details: `Kostenschätzung ${verb}: CHF ${confirmedPrice}/Sitzung · ${confirmedMin}–${confirmedMax} Sitzungen · ${label}`,
    });

    const chatText =
        `Dein Studio hat die Einschätzung für ${caseDoc.caseId} ${verb}: ` +
        `CHF ${confirmedPrice} pro Sitzung, voraussichtlich ${confirmedMin}–${confirmedMax} Sitzungen.` +
        (notiz ? ` Hinweis: ${notiz}` : '') +
        ' Der endgültige Preis und die finale Sitzungszahl werden im Studio besprochen.';

    caseDoc.chat_nachrichten.push({
        von: 'studio',
        typ: 'system',
        text: chatText,
        datum: now,
        gelesen: false,
    });
    caseDoc.markModified('chat_nachrichten');

    await caseDoc.save();

    let chatNotified = false;
    try {
        const conversation = await messagingService.getOrCreateConversation(req.user, {
            customer_id: refId(caseDoc.customer),
            studio_id: refId(caseDoc.studio),
        });
        const chatPayload = await messagingService.sendMessage(req.user, conversation.id, {
            text: chatText,
            case_id: String(caseDoc._id),
        });
        emitMessageCreated(chatPayload);
        chatNotified = true;
    } catch (error) {
        console.error('Estimate confirmation chat notification failed:', error.message);
    }

    require('../utils/openActionService').publishOpenActionsChanged(caseDoc.studio);

    res.status(200).json({
        success: true,
        message: `Estimate ${verb}`,
        data: {
            estimate_confirmation: formatEstimateConfirmation(
                caseDoc.estimate_confirmation,
                req.user.role
            ),
            ...resolveDisplayedPrices(caseDoc),
            sessionsMin: caseDoc.sessionsMin,
            sessionsMax: caseDoc.sessionsMax,
            chat_notified: chatNotified,
        },
    });
});

const resolveStudioForPreview = async (user) => {
    if (isStudio(user.role)) {
        return user.studio_id;
    }

    if (isCustomer(user.role) && user.customer_id) {
        const customer = await Customer.findById(user.customer_id).select('aktuelle_firma_id').lean();
        return customer?.aktuelle_firma_id ?? null;
    }

    return user.studio_id ?? null;
};

const previewCasePricing = asyncHandler(async (req, res) => {
    const { zonen = [], ...rawFields } = req.body;
    const caseFields = syncDerivedIntakeFields(rawFields);
    const pricingInput = { ...caseFields, zonen };

    const studioId = await resolveStudioForPreview(req.user);
    const pricingOverrides = studioId
        ? await getEffectivePricingOverrides(studioId)
        : {};

    const result = calculateCasePreview(pricingInput, pricingOverrides);
    const payload = isCustomer(req.user.role)
        ? formatCustomerPreview(result)
        : result;

    res.status(200).json({
        success: true,
        data: payload,
    });
});

module.exports = {
    createCase,
    listCases,
    getCase,
    updateCase,
    deleteIncompleteCase,
    getCaseAvailability,
    getCaseStandorte,
    getCaseIntakePrefill,
    getCasePricing,
    previewCasePricing,
    updateEstimateConfirmation,
    formatCase,
};

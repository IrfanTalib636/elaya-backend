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
    CUSTOMER_INTAKE_FIELDS,
    syncDerivedIntakeFields,
} = require('../utils/caseIntakeHelpers');
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
    'tc_density',
    'tc_saturation',
    'tc_shading',
    'tc_linework',
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
        removal: doc.removal,
        healing: doc.healing,
        status: doc.status,
        medical_flag_level: doc.medical_flag_level,
        open_medical_flags_count: doc.open_medical_flags_count ?? 0,
        anamnesis_complete: doc.anamnesis_complete ?? false,
        signature_complete: !!doc.unterschrift?.zeitstempel,
        lastSessionDate: doc.lastSessionDate,
        akquise_quelle: doc.akquise_quelle,
        zonen_aktiv: doc.zonen_aktiv,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };

    // Shared Case Layer: case originated at another studio, now visible here
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
                flaeche_cm2: zone.flaeche_cm2,
                flaeche_template: zone.flaeche_template,
                flaeche_modus: zone.flaeche_modus,
                flaeche_manuell: zone.flaeche_manuell,
                foto_url: zone.foto_url,
                fortschritt_prozent: zone.fortschritt_prozent,
            };
            if (!isCustomer(role)) {
                formatted.preis = zone.preis;
                formatted.sitzungen_geschaetzt_min = zone.sitzungen_geschaetzt_min;
                formatted.sitzungen_geschaetzt_max = zone.sitzungen_geschaetzt_max;
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

const buildZoneDocs = (caseId, zonenInput) => {
    if (!zonenInput.length) {
        return [];
    }

    return zonenInput.map((zone, index) => ({
        case: caseId,
        zonen_id: zone.zonen_id || `Z${String(index + 1).padStart(3, '0')}`,
        bezeichnung: zone.bezeichnung,
        koerperstelle: zone.koerperstelle,
        farben: zone.farben,
        dichte: zone.dichte ?? null,
        flaeche_cm2: zone.flaeche_cm2 ?? null,
        flaeche_template: zone.flaeche_template ?? null,
        flaeche_modus: zone.flaeche_modus ?? null,
        flaeche_manuell: zone.flaeche_manuell ?? null,
        foto_url: zone.foto_url,
        preis: zone.preis,
        sitzungen_geschaetzt_min: zone.sitzungen_geschaetzt_min,
        sitzungen_geschaetzt_max: zone.sitzungen_geschaetzt_max,
    }));
};

const syncCaseZones = async (caseDoc, zonenInput) => {
    if (zonenInput === undefined) {
        return [];
    }

    await CaseZone.deleteMany({ case: caseDoc._id });

    if (!zonenInput.length) {
        return [];
    }

    return CaseZone.insertMany(buildZoneDocs(caseDoc._id, zonenInput));
};

/** Intake fields that feed the price / session-range estimate. */
const ESTIMATE_RELEVANT_FIELDS = [
    'type',
    'tc_colors_present',
    'tc_size_length',
    'tc_size_width',
    'tc_type',
    'tc_age_bucket',
    'tc_age_years',
    'tc_density',
    'tc_body_location_main',
    'tc_coverup',
    'tc_prior_treatment',
    'tc_prior_treatment_count',
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
    'tc_saturation',
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

/** Server-computed estimate fields — clients may not force these directly. */
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

/**
 * Recompute + persist the AI estimate (price per session + session range)
 * from the owning studio's pricing config. Once the studio has confirmed or
 * adjusted the estimate, the confirmed values win and are never overwritten.
 */
const refreshCaseEstimate = async (caseDoc, zoneDocs = null) => {
    const pricingInput = caseDoc.toObject ? caseDoc.toObject() : { ...caseDoc };

    if (caseDoc.zonen_aktiv) {
        const zones =
            zoneDocs ??
            (await CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 }).lean());
        pricingInput.zonen = zones.map((z) => (z.toObject ? z.toObject() : z));
    }

    const pricingOverrides = await getEffectivePricingOverrides(caseDoc.studio);
    const preview = calculateCasePreview(pricingInput, pricingOverrides);
    applyCalculatedPreview(caseDoc, preview);
    await caseDoc.save();
};

const applyCaseUpdate = async (caseDoc, body) => {
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

    return syncCaseZones(caseDoc, zonen);
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

    let caseDoc = null;
    let zoneDocs = [];

    try {
        caseDoc = await Case.create({
            ...caseFields,
            customer: customer._id,
            studio: studioId,
            caseId,
            akquise_quelle: caseFields.akquise_quelle ?? customer.akquise_quelle,
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
            const linkedZones = await linkZonePhotoFiles(caseDoc, zonen, req.user, req);
            zoneDocs = await CaseZone.insertMany(buildZoneDocs(caseDoc._id, linkedZones));
        }

        // Persist the AI estimate (price + session range) for BOTH tattoo and
        // PMU cases, computed from the owning studio's pricing configuration.
        await refreshCaseEstimate(caseDoc, zoneDocs);
    } catch (error) {
        if (caseDoc?._id) {
            await CaseZone.deleteMany({ case: caseDoc._id });
            await Case.deleteOne({ _id: caseDoc._id });
        }
        throw error;
    }

    res.status(201).json({
        success: true,
        message: 'Case created successfully',
        data: {
            case: formatCase(caseDoc, zoneDocs, req.user.role),
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

    const zones = caseDoc.zonen_aktiv
        ? await CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 })
        : [];

    const viewerStudioId = isStudio(req.user.role) ? req.user.studio_id : null;
    if (!(caseDoc.calculated_pricePerSession > 0)) {
        try {
            await refreshCaseEstimate(caseDoc, zones);
        } catch (error) {
            console.error('Calculated estimate snapshot failed:', error.message);
        }
    }
    const formatted = formatCase(caseDoc, zones, req.user.role, { viewerStudioId });
    if (access.transferiert) formatted.transferiert = true;
    if (access.read_only) formatted.read_only = true;

    res.status(200).json({
        success: true,
        data: {
            case: formatted,
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

    // Estimate outputs are server-computed (and studio-confirmed values are
    // immutable) — ignore any client-sent values; refreshCaseEstimate below
    // recomputes them from the studio's pricing config when still offen.
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

    const zoneDocs = await applyCaseUpdate(caseDoc, req.body);

    if (touchedEstimate) {
        await refreshCaseEstimate(
            caseDoc,
            req.body.zonen !== undefined ? zoneDocs : null
        );
    }

    await caseDoc.populate('customer', 'vorname nachname email telefon');

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

/**
 * Customer (or studio/admin) may delete an incomplete intake case that was never signed.
 * Used to clean up orphan drafts created when Basics is submitted more than once.
 */
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

    await CaseZone.deleteMany({ case: caseDoc._id });
    await Session.deleteMany({ case: caseDoc._id });
    await Appointment.deleteMany({ case: caseDoc._id });
    await Anamnesis.deleteMany({ case: caseDoc._id });
    await Case.deleteOne({ _id: caseDoc._id });

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

    const { consultationOnly, from, to, ...preSessionInput } = req.query;

    const result = await computeAvailability({
        activeCaseId: caseDoc._id,
        customerId: caseDoc.customer,
        consultationOnly: consultationOnly ?? false,
        preSessionCheck: parsePreSessionCheck(preSessionInput),
        from,
        to,
    });

    res.status(200).json({
        success: true,
        data: result,
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

/**
 * PATCH /cases/:id/estimate-confirmation — studio confirms (or adjusts) the
 * AI price + session-range estimate directly inside the customer's case.
 * The customer is notified automatically via the internal live chat.
 */
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
        // Re-open: estimate becomes AI-driven again and is recomputed.
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

    // Confirmed values become the case values shown everywhere.
    caseDoc.pricePerSession = confirmedPrice;
    caseDoc.sessionsMin = confirmedMin;
    caseDoc.sessionsMax = confirmedMax;
    caseDoc.sessions = confirmedMax;

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

    // Live-chat notification to the customer (best effort — the confirmation
    // itself must not fail if messaging is unavailable).
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
    getCasePricing,
    previewCasePricing,
    updateEstimateConfirmation,
    formatCase,
};

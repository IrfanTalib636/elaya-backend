const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const Customer = require('../models/customerModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { generateCaseId } = require('../utils/generateCaseId');
const { assertCaseAccess, assertCaseWriteAccess, buildStudioSharedFilter, refId } = require('../utils/accessHelpers');
const {
    computeAvailability,
    parsePreSessionCheck,
} = require('../utils/lockoutEngine');
const {
    calculatePrice,
    calculateCasePreview,
    formatCustomerEstimate,
    formatCustomerPreview,
    formatStudioPricing,
} = require('../utils/pricingEngine');
const { getEffectivePricingOverrides } = require('../utils/configService');
const { USER_ROLES, CASE_TYPE, CASE_STATUS } = require('../config/constants');
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

const formatCase = (caseDoc, zones, role, options = {}) => {
    const doc = caseDoc.toObject ? caseDoc.toObject() : { ...caseDoc };
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

    if (!isCustomer(role)) {
        payload.pricePerSession = doc.pricePerSession;
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

    if (isAdmin(role)) {
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

    // Apply prototype PMU session + price estimate when creating a PMU case
    if (caseFields.type === CASE_TYPE.PMU) {
        const pricingOverrides = await getEffectivePricingOverrides(studioId);
        const preview = calculateCasePreview(caseFields, pricingOverrides);
        caseFields.pricePerSession = preview.pricePerSession;
        caseFields.sessions = preview.sessions?.base ?? preview.sessions?.max ?? 0;
        caseFields.sessionsMin = preview.sessions?.min ?? 0;
        caseFields.sessionsMax = preview.sessions?.max ?? 0;
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

    if (
        req.body.zonen_aktiv &&
        req.body.zonen?.length > 0 &&
        (req.body.zonen.length < 2 || req.body.zonen.length > 8)
    ) {
        throw new ApiError(400, 'Zone mode requires between 2 and 8 zones');
    }

    const zoneDocs = await applyCaseUpdate(caseDoc, req.body);

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

    if (caseDoc.unterschrift?.zeitstempel) {
        throw new ApiError(400, 'Signed cases cannot be deleted from the app');
    }

    const deletable =
        caseDoc.status === CASE_STATUS.DRAFT ||
        caseDoc.status === CASE_STATUS.PENDING;

    if (!deletable) {
        throw new ApiError(400, 'Only incomplete draft/pending cases can be deleted');
    }

    await CaseZone.deleteMany({ case: caseDoc._id });
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
    const result = caseDoc.zonen_aktiv && pricingInput.zonen?.length
        ? calculateCasePreview(pricingInput, pricingOverrides)
        : calculatePrice(pricingInput, pricingOverrides);
    const payload = isCustomer(req.user.role)
        ? formatCustomerEstimate(
              result.sessions
                  ? result
                  : {
                        ...result,
                        sessions: {
                            min: caseDoc.sessionsMin,
                            max: caseDoc.sessionsMax,
                        },
                        totalMin: result.pricePerSession * (caseDoc.sessionsMin || 0),
                        totalMax: result.pricePerSession * (caseDoc.sessionsMax || 0),
                    }
          )
        : result.sessions
          ? result
          : formatStudioPricing(result);

    res.status(200).json({
        success: true,
        data: payload,
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
    formatCase,
};

const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const Customer = require('../models/customerModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { generateCaseId } = require('../utils/generateCaseId');
const { assertCaseAccess } = require('../utils/accessHelpers');
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
const { USER_ROLES } = require('../config/constants');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const {
    CUSTOMER_INTAKE_FIELDS,
    syncDerivedIntakeFields,
} = require('../utils/caseIntakeHelpers');

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
    'goal_notes',
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

const formatCase = (caseDoc, zones, role) => {
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
        lastSessionDate: doc.lastSessionDate,
        akquise_quelle: doc.akquise_quelle,
        zonen_aktiv: doc.zonen_aktiv,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };

    INTAKE_RESPONSE_FIELDS.forEach((field) => {
        payload[field] = doc[field];
    });

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

        if (zonen.length > 0) {
            zoneDocs = await CaseZone.insertMany(buildZoneDocs(caseDoc._id, zonen));
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
    const filter = {};

    if (isCustomer(req.user.role)) {
        filter.customer = req.user.customer_id;
    } else if (isStudio(req.user.role)) {
        filter.studio = req.user.studio_id;
        if (req.query.customer_id) {
            filter.customer = req.query.customer_id;
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
            cases: cases.map((c) => formatCase(c, null, req.user.role)),
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

    await assertCaseAccess(req.user, caseDoc);

    const zones = caseDoc.zonen_aktiv
        ? await CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 })
        : [];

    res.status(200).json({
        success: true,
        data: {
            case: formatCase(caseDoc, zones, req.user.role),
        },
    });
});

const updateCase = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseAccess(req.user, caseDoc);

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

const getCaseAvailability = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    assertCaseAccess(req.user, caseDoc);

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

    assertCaseAccess(req.user, caseDoc);

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
    getCaseAvailability,
    getCasePricing,
    previewCasePricing,
};

const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const Customer = require('../models/customerModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { generateCaseId } = require('../utils/generateCaseId');
const { assertCaseAccess } = require('../utils/accessHelpers');
const {
    computeAvailability,
} = require('../utils/lockoutEngine');
const {
    calculatePrice,
    formatCustomerEstimate,
    formatStudioPricing,
} = require('../utils/pricingEngine');
const { getEffectivePricingOverrides } = require('../utils/configService');
const { USER_ROLES } = require('../config/constants');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

const STUDIO_ROLES = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

const isCustomer = (role) => role === USER_ROLES.CUSTOMER;
const isStudio = (role) => STUDIO_ROLES.includes(role);
const isAdmin = (role) => ADMIN_ROLES.includes(role);

const formatCase = (caseDoc, zones, role) => {
    const doc = caseDoc.toObject ? caseDoc.toObject() : { ...caseDoc };
    const payload = {
        id: doc._id,
        caseId: doc.caseId,
        customer: doc.customer,
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
        lastSessionDate: doc.lastSessionDate,
        akquise_quelle: doc.akquise_quelle,
        zonen_aktiv: doc.zonen_aktiv,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };

    if (!isCustomer(role)) {
        payload.pricePerSession = doc.pricePerSession;
        payload.uvBlockDate = doc.uvBlockDate;
        payload.medicationBlockDate = doc.medicationBlockDate;
        payload.sperrfrist_deaktiviert = doc.sperrfrist_deaktiviert;
    }

    if (isAdmin(role)) {
        payload.unterschrift = doc.unterschrift;
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
        foto_url: zone.foto_url,
        preis: zone.preis,
        sitzungen_geschaetzt_min: zone.sitzungen_geschaetzt_min,
        sitzungen_geschaetzt_max: zone.sitzungen_geschaetzt_max,
    }));
};

const createCase = asyncHandler(async (req, res) => {
    const { customer_id, zonen, ...caseFields } = req.body;

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
    }

    const { page, limit, skip } = parsePagination(req.query);

    const [cases, total] = await Promise.all([
        Case.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
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
    const caseDoc = await Case.findById(req.params.id);

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
        const allowed = new Set([
            'tc_title',
            'bodyLabel',
            'tc_colors_present',
            'tc_size_length',
            'tc_size_width',
            'tc_type',
            'tc_age_years',
            'skin_fitzpatrick',
            'tc_coverup',
            'goal_target',
        ]);
        const blocked = Object.keys(req.body).filter((key) => !allowed.has(key));
        if (blocked.length > 0) {
            throw new ApiError(403, `Customers cannot update: ${blocked.join(', ')}`);
        }
    }

    Object.assign(caseDoc, req.body);
    await caseDoc.save();

    const zones = caseDoc.zonen_aktiv
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

    const { consultationOnly, from, to, uv_level } = req.query;

    const result = await computeAvailability({
        activeCaseId: caseDoc._id,
        customerId: caseDoc.customer,
        consultationOnly: consultationOnly ?? false,
        preSessionCheck: uv_level ? { uv_level } : {},
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
        const firstZone = await CaseZone.findOne({ case: caseDoc._id }).sort({ zonen_id: 1 });
        if (firstZone?.koerperstelle && !pricingInput.koerperstelle) {
            pricingInput.koerperstelle = firstZone.koerperstelle;
        }
    }

    const pricingOverrides = await getEffectivePricingOverrides(caseDoc.studio);
    const result = calculatePrice(pricingInput, pricingOverrides);
    const payload = isCustomer(req.user.role)
        ? formatCustomerEstimate(result)
        : formatStudioPricing(result);

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
};

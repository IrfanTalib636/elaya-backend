const crypto = require('crypto');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Case = require('../models/caseModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { isAdmin, isStudio } = require('../utils/accessHelpers');
const { USER_ROLES, AKQUISE_QUELLE, PIPELINE_STUFE } = require('../config/constants');
const { worstMedicalFlagLevel } = require('../utils/medicalFlagHelpers');

// ── helpers ──────────────────────────────────────────────────────────────
const assertCustomerAccess = (user, customer) => {
    if (isAdmin(user.role)) return;
    if (
        isStudio(user.role) &&
        customer.aktuelle_firma_id.toString() === user.studio_id.toString()
    ) return;
    throw new ApiError(403, 'You do not have access to this customer');
};

// ── GET /customers ────────────────────────────────────────────────────────
const listCustomers = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { search, pipeline_stufe } = req.query;

    const filter = {};

    // scope to studio
    if (isStudio(req.user.role)) {
        filter.aktuelle_firma_id = req.user.studio_id;
    }

    if (pipeline_stufe) {
        filter.pipeline_stufe = pipeline_stufe;
    }

    if (search) {
        const re = new RegExp(search, 'i');
        filter.$or = [{ vorname: re }, { nachname: re }, { email: re }, { telefon: re }];
    }

    const [customers, total] = await Promise.all([
        Customer.find(filter)
            .sort({ nachname: 1, vorname: 1 })
            .skip(skip)
            .limit(limit)
            .select('-elaycoins.transactions -firma_history')
            .lean(),
        Customer.countDocuments(filter),
    ]);

    // attach open case counts
    const ids = customers.map((c) => c._id);
    const caseCounts = await Case.aggregate([
        { $match: { customer: { $in: ids }, status: { $in: ['pending', 'active'] } } },
        { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(caseCounts.map((x) => [x._id.toString(), x.count]));
    const enriched = customers.map((c) => ({
        ...c,
        offene_faelle: countMap[c._id.toString()] ?? 0,
    }));

    res.json({
        success: true,
        data: {
            customers: enriched,
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

// ── POST /customers ───────────────────────────────────────────────────────
const createCustomer = asyncHandler(async (req, res) => {
    if (!isStudio(req.user.role) && !isAdmin(req.user.role)) {
        throw new ApiError(403, 'Only studio staff or admins can create customers');
    }

    const { vorname, nachname, email, telefon, geburtsdatum, strasse, plz, ort, land, notizen } =
        req.body;

    const existing = await User.findOne({ email });
    if (existing) throw new ApiError(409, 'A user with this email already exists');

    const studioId = isAdmin(req.user.role) ? req.body.studio_id : req.user.studio_id;
    if (!studioId) throw new ApiError(400, 'studio_id is required');

    // temp password — customer will set their own via mobile app (M3)
    const tempPassword = crypto.randomBytes(16).toString('hex');

    const user = await User.create({
        email,
        password: tempPassword,
        role: USER_ROLES.CUSTOMER,
    });

    const customer = await Customer.create({
        user: user._id,
        vorname,
        nachname,
        email,
        telefon,
        geburtsdatum: geburtsdatum || null,
        strasse: strasse || '',
        plz: plz || '',
        ort: ort || '',
        land: land || 'Schweiz',
        notizen: notizen || '',
        akquise_quelle: AKQUISE_QUELLE.STUDIO_EIGEN,
        aktuelle_firma_id: studioId,
        pipeline_stufe: PIPELINE_STUFE.NEU,
        stufe_seit: new Date(),
    });

    // link customer_id back to user
    await User.findByIdAndUpdate(user._id, { customer_id: customer._id });

    res.status(201).json({
        success: true,
        message: 'Customer created',
        data: { customer },
    });
});

// ── GET /customers/:id ────────────────────────────────────────────────────
const getCustomer = asyncHandler(async (req, res) => {
    const customer = await Customer.findById(req.params.id)
        .populate('user', 'email status last_login')
        .lean();

    if (!customer) throw new ApiError(404, 'Customer not found');
    assertCustomerAccess(req.user, customer);

    // attach case summary (studio users only see cases at their studio)
    const caseFilter = { customer: customer._id };
    if (isStudio(req.user.role)) {
        caseFilter.studio = req.user.studio_id;
    }

    const cases = await Case.find(caseFilter)
        .select(
            'caseId type tc_title status sessions sessionsDone removal lastSessionDate medical_flag_level open_medical_flags_count anamnesis_complete'
        )
        .sort({ createdAt: -1 })
        .lean();

    const worst_medical_flag_level = worstMedicalFlagLevel(
        cases.map((c) => c.medical_flag_level).filter(Boolean)
    );
    const open_medical_flags_count = cases.reduce(
        (sum, c) => sum + (c.open_medical_flags_count ?? 0),
        0
    );
    const pending_anamnesis_count = cases.filter((c) => !c.anamnesis_complete).length;

    res.json({
        success: true,
        data: {
            customer: {
                ...customer,
                cases,
                worst_medical_flag_level,
                open_medical_flags_count,
                pending_anamnesis_count,
            },
        },
    });
});

// ── PATCH /customers/:id ──────────────────────────────────────────────────
const updateCustomer = asyncHandler(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw new ApiError(404, 'Customer not found');
    assertCustomerAccess(req.user, customer);

    const studioAllowed = [
        'vorname', 'nachname', 'telefon', 'geburtsdatum',
        'strasse', 'plz', 'ort', 'land', 'notizen', 'pipeline_stufe',
    ];
    const adminOnly = ['akquise_quelle', 'aktuelle_firma_id'];

    const allowed = isAdmin(req.user.role) ? [...studioAllowed, ...adminOnly] : studioAllowed;

    allowed.forEach((field) => {
        if (req.body[field] !== undefined) {
            customer[field] = req.body[field];
        }
    });

    await customer.save();

    res.json({
        success: true,
        message: 'Customer updated',
        data: { customer },
    });
});

module.exports = { listCustomers, createCustomer, getCustomer, updateCustomer };

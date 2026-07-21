const crypto = require('crypto');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Case = require('../models/caseModel');
const Studio = require('../models/studioModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const {
    isAdmin,
    isStudio,
    resolveStudioCustomerRelation,
    refId,
} = require('../utils/accessHelpers');
const { USER_ROLES, AKQUISE_QUELLE, PIPELINE_STUFE } = require('../config/constants');
const { worstMedicalFlagLevel } = require('../utils/medicalFlagHelpers');
const { formatFirmaTimeline } = require('../utils/customerProfileHelpers');

// ── helpers ──────────────────────────────────────────────────────────────
const assertCustomerAccess = (user, customer, { allowFormer = true } = {}) => {
    if (isAdmin(user.role)) {
        return {
            wechsel_status: 'aktuell',
            is_current: true,
            read_only: false,
            vorheriges_studio_id: null,
            transferiert_am: null,
        };
    }

    if (isStudio(user.role)) {
        const relation = resolveStudioCustomerRelation(user.studio_id, customer);
        if (relation.wechsel_status === 'none') {
            throw new ApiError(403, 'You do not have access to this customer');
        }
        if (!allowFormer && relation.wechsel_status === 'transferiert_aus') {
            throw new ApiError(403, 'You do not have access to this customer');
        }
        return relation;
    }

    throw new ApiError(403, 'You do not have access to this customer');
};

const enrichWechselMeta = async (relation) => {
    if (!relation?.vorheriges_studio_id) {
        return { ...relation, vorheriges_studio_name: null };
    }
    const studio = await Studio.findById(relation.vorheriges_studio_id).select('firma').lean();
    return {
        ...relation,
        vorheriges_studio_name: studio?.firma ?? null,
    };
};

// ── GET /customers ────────────────────────────────────────────────────────
const listCustomers = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { search, pipeline_stufe } = req.query;

    const filter = {};
    const studioId = isStudio(req.user.role) ? refId(req.user.studio_id) : null;

    // Studio: current customers + former customers who transferred out (firma_history)
    if (studioId) {
        filter.$or = [
            { aktuelle_firma_id: req.user.studio_id },
            { 'firma_history.firma_id': req.user.studio_id },
        ];
    }

    if (pipeline_stufe) {
        filter.pipeline_stufe = pipeline_stufe;
    }

    if (search) {
        const re = new RegExp(search, 'i');
        filter.$and = [
            ...(filter.$and ?? []),
            { $or: [{ vorname: re }, { nachname: re }, { email: re }, { telefon: re }] },
        ];
    }

    const [customers, total] = await Promise.all([
        Customer.find(filter)
            .sort({ nachname: 1, vorname: 1 })
            .skip(skip)
            .limit(limit)
            .select('-elaycoins.transactions')
            .lean(),
        Customer.countDocuments(filter),
    ]);

    const ids = customers.map((c) => c._id);
    const openCases = ids.length
        ? await Case.find({
              customer: { $in: ids },
              status: { $in: ['pending', 'active'] },
          })
              .select('customer studio')
              .lean()
        : [];

    const openCasesByCustomer = openCases.reduce((acc, caseDoc) => {
        const cid = refId(caseDoc.customer);
        if (!acc[cid]) acc[cid] = [];
        acc[cid].push(caseDoc);
        return acc;
    }, {});

    const transferredOutIds = studioId
        ? customers
              .filter((c) => resolveStudioCustomerRelation(studioId, c).wechsel_status === 'transferiert_aus')
              .map((c) => refId(c.aktuelle_firma_id))
              .filter(Boolean)
        : [];
    const aktuelleFirmaNames = transferredOutIds.length
        ? Object.fromEntries(
              (
                  await Studio.find({ _id: { $in: [...new Set(transferredOutIds)] } })
                      .select('firma')
                      .lean()
              ).map((s) => [String(s._id), s.firma ?? ''])
          )
        : {};

    const enriched = customers.map((c) => {
        const relation = studioId
            ? resolveStudioCustomerRelation(studioId, c)
            : { wechsel_status: 'aktuell', read_only: false };
        const customerCases = openCasesByCustomer[c._id.toString()] ?? [];
        const offene_faelle =
            relation.wechsel_status === 'transferiert_aus'
                ? customerCases.filter((caseDoc) => refId(caseDoc.studio) === studioId).length
                : customerCases.length;

        return {
            ...c,
            offene_faelle,
            wechsel_status: relation.wechsel_status,
            transferiert_am: relation.transferiert_am ?? null,
            read_only: !!relation.read_only,
            aktuelle_firma_name:
                relation.wechsel_status === 'transferiert_aus'
                    ? aktuelleFirmaNames[String(c.aktuelle_firma_id)] ?? null
                    : null,
            elaycoins_balance: c.elaycoins?.balance ?? 0,
        };
    });

    if (studioId) {
        enriched.sort((a, b) => {
            const aOut = a.wechsel_status === 'transferiert_aus' ? 1 : 0;
            const bOut = b.wechsel_status === 'transferiert_aus' ? 1 : 0;
            if (aOut !== bOut) return aOut - bOut;
            return `${a.nachname} ${a.vorname}`.localeCompare(`${b.nachname} ${b.vorname}`, 'de');
        });
    }

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
        firma_history: [
            {
                firma_id: studioId,
                von: new Date(),
                bis: null,
                grund: 'studio_anlage',
            },
        ],
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
    const relation = assertCustomerAccess(req.user, customer);
    const wechsel = isStudio(req.user.role)
        ? await enrichWechselMeta(relation)
        : { wechsel_status: 'aktuell' };

    // Shared Case Layer: current studio sees full medical history; former studio only own cases
    const caseFilter = { customer: customer._id };
    if (isStudio(req.user.role)) {
        if (wechsel.wechsel_status === 'transferiert_aus') {
            caseFilter.studio = req.user.studio_id;
        }
        // transferiert_ein / aktuell → all cases
    }

    const cases = await Case.find(caseFilter)
        .select(
            'caseId type tc_title status sessions sessionsDone removal lastSessionDate medical_flag_level open_medical_flags_count anamnesis_complete studio bodyLabel'
        )
        .sort({ createdAt: -1 })
        .lean();

    const viewerStudioId = isStudio(req.user.role) ? refId(req.user.studio_id) : null;
    const casesFormatted = cases.map((c) => ({
        ...c,
        id: c._id,
        transferiert: !!(viewerStudioId && refId(c.studio) !== viewerStudioId),
        herkunft_studio_id: refId(c.studio),
    }));

    const worst_medical_flag_level = worstMedicalFlagLevel(
        casesFormatted.map((c) => c.medical_flag_level).filter(Boolean)
    );
    const open_medical_flags_count = casesFormatted.reduce(
        (sum, c) => sum + (c.open_medical_flags_count ?? 0),
        0
    );
    const pending_anamnesis_count = casesFormatted.filter((c) => !c.anamnesis_complete).length;

    // Resolve aktuelle studio name for "left" banner
    let aktuelle_firma_name = null;
    if (wechsel.wechsel_status === 'transferiert_aus' && customer.aktuelle_firma_id) {
        const s = await Studio.findById(customer.aktuelle_firma_id).select('firma').lean();
        aktuelle_firma_name = s?.firma ?? null;
    }

    const firma_timeline = await formatFirmaTimeline(customer.firma_history);

    res.json({
        success: true,
        data: {
            customer: {
                ...customer,
                cases: casesFormatted,
                worst_medical_flag_level,
                open_medical_flags_count,
                pending_anamnesis_count,
                wechsel_status: wechsel.wechsel_status,
                vorheriges_studio_id: wechsel.vorheriges_studio_id ?? null,
                vorheriges_studio_name: wechsel.vorheriges_studio_name ?? null,
                transferiert_am: wechsel.transferiert_am ?? null,
                aktuelle_firma_name,
                read_only: !!wechsel.read_only,
                firma_timeline,
                // Coins travel with the customer across studios
                elaycoins_balance: customer.elaycoins?.balance ?? 0,
            },
        },
    });
});

// ── PATCH /customers/:id ──────────────────────────────────────────────────
const updateCustomer = asyncHandler(async (req, res) => {
    const customer = await Customer.findById(req.params.id);
    if (!customer) throw new ApiError(404, 'Customer not found');
    const relation = assertCustomerAccess(req.user, customer);
    if (relation.read_only) {
        throw new ApiError(
            403,
            'Customer transferred to another studio — profile is read-only'
        );
    }

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

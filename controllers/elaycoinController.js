const { getElaycoinData } = require('../utils/elaycoinEngine');
const { isCustomer, isStudio, isAdmin } = require('../utils/accessHelpers');
const { resolveStudioId } = require('../utils/studioScope');
const { USER_ROLES } = require('../config/constants');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const resolveCustomerOrThrow = async (customerId) => {
    const customer = await Customer.findById(customerId).select('_id').lean();
    if (customer) {
        return customer._id;
    }

    const asUser = await User.findById(customerId).select('customer_id role').lean();
    if (asUser?.customer_id) {
        throw new ApiError(
            400,
            `Path param is a User ID, not a Customer ID. Use customer ID: ${asUser.customer_id}`
        );
    }

    throw new ApiError(404, 'Customer not found');
};

const assertCustomerElaycoinAccess = async (user, customerId) => {
    if (isAdmin(user.role)) {
        return;
    }

    if (isCustomer(user.role)) {
        if (user.customer_id.toString() !== customerId.toString()) {
            throw new ApiError(403, 'You do not have access to this Elaycoin account');
        }
        return;
    }

    if (isStudio(user.role)) {
        const belongs = await Customer.exists({
            _id: customerId,
            aktuelle_firma_id: user.studio_id,
        });
        if (!belongs) {
            throw new ApiError(403, 'You do not have access to this customer');
        }
        return;
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const getMyElaycoins = asyncHandler(async (req, res) => {
    if (req.user.role !== USER_ROLES.CUSTOMER || !req.user.customer_id) {
        throw new ApiError(
            403,
            'Only customers can access GET /elaycoins/me. Studio/admin: use GET /elaycoins/customers/:customerId'
        );
    }

    const data = await getElaycoinData(req.user.customer_id, { forStudio: false });
    if (!data) {
        throw new ApiError(404, 'Customer profile not found');
    }

    res.status(200).json({
        success: true,
        data: { elaycoins: data },
    });
});

const getCustomerElaycoins = asyncHandler(async (req, res) => {
    const customerObjectId = await resolveCustomerOrThrow(req.params.customerId);
    await assertCustomerElaycoinAccess(req.user, customerObjectId);

    const forStudio = !isCustomer(req.user.role);
    const studioId = forStudio && isStudio(req.user.role) ? req.user.studio_id : null;
    const data = await getElaycoinData(customerObjectId, { forStudio, studioId });

    if (!data) {
        throw new ApiError(404, 'Customer not found');
    }

    res.status(200).json({
        success: true,
        data: { elaycoins: data },
    });
});

/** GET /elaycoins/studio/overview — all studio customers with coin balance */
const listStudioElaycoinOverview = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);

    const { page, limit, skip } = parsePagination(req.query);
    const filter = { aktuelle_firma_id: studioId };

    const [customers, total, agg] = await Promise.all([
        Customer.find(filter)
            .sort({ 'elaycoins.balance': -1, nachname: 1, vorname: 1 })
            .skip(skip)
            .limit(limit)
            .select('vorname nachname email elaycoins.balance elaycoins.transactions akquise_quelle')
            .lean(),
        Customer.countDocuments(filter),
        Customer.aggregate([
            { $match: { aktuelle_firma_id: studioId } },
            {
                $group: {
                    _id: null,
                    total_balance: { $sum: { $ifNull: ['$elaycoins.balance', 0] } },
                    with_balance: {
                        $sum: {
                            $cond: [{ $gt: [{ $ifNull: ['$elaycoins.balance', 0] }, 0] }, 1, 0],
                        },
                    },
                },
            },
        ]),
    ]);

    const studioIdStr = String(studioId);
    const summary = agg[0] ?? { total_balance: 0, with_balance: 0 };

    res.json({
        success: true,
        data: {
            summary: {
                total_balance: summary.total_balance,
                customers_with_balance: summary.with_balance,
                total_customers: total,
            },
            customers: customers.map((c) => {
                const txs = c.elaycoins?.transactions || [];
                const studioTxs = txs.filter(
                    (t) =>
                        String(t.herkunft_studio_id || '') === studioIdStr ||
                        !t.herkunft_studio_id
                );
                const redeemed_here = studioTxs
                    .filter((t) => (t.coins ?? 0) < 0)
                    .reduce((s, t) => s + Math.abs(t.coins || 0), 0);
                const credited_here = studioTxs
                    .filter((t) => (t.coins ?? 0) > 0)
                    .reduce((s, t) => s + (t.coins || 0), 0);
                return {
                    id: c._id,
                    vorname: c.vorname,
                    nachname: c.nachname,
                    email: c.email,
                    akquise_quelle: c.akquise_quelle,
                    balance: c.elaycoins?.balance ?? 0,
                    credited_at_studio: credited_here,
                    redeemed_at_studio: redeemed_here,
                    recent_transactions: studioTxs
                        .slice()
                        .sort((a, b) => new Date(b.datum) - new Date(a.datum))
                        .slice(0, 5)
                        .map((t) => ({
                            id: t._id,
                            situationKey: t.situationKey,
                            label: t.label,
                            coins: t.coins,
                            typ: t.typ,
                            datum: t.datum,
                            herkunft_studio_name: t.herkunft_studio_name,
                        })),
                };
            }),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** GET /elaycoins/admin/overview — cross-studio balances + recent txs */
const listAdminElaycoinOverview = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.studio_id) {
        filter.aktuelle_firma_id = req.query.studio_id;
    }
    if (req.query.q) {
        const q = String(req.query.q).trim();
        filter.$or = [
            { vorname: new RegExp(q, 'i') },
            { nachname: new RegExp(q, 'i') },
            { email: new RegExp(q, 'i') },
        ];
    }

    const [customers, total, agg] = await Promise.all([
        Customer.find(filter)
            .sort({ 'elaycoins.balance': -1 })
            .skip(skip)
            .limit(limit)
            .select(
                'vorname nachname email elaycoins.balance elaycoins.transactions aktuelle_firma_id'
            )
            .populate('aktuelle_firma_id', 'firma studio_code')
            .lean(),
        Customer.countDocuments(filter),
        Customer.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: null,
                    total_balance: { $sum: { $ifNull: ['$elaycoins.balance', 0] } },
                    with_balance: {
                        $sum: {
                            $cond: [{ $gt: [{ $ifNull: ['$elaycoins.balance', 0] }, 0] }, 1, 0],
                        },
                    },
                },
            },
        ]),
    ]);

    const summary = agg[0] ?? { total_balance: 0, with_balance: 0 };

    res.json({
        success: true,
        data: {
            summary: {
                total_balance: summary.total_balance,
                customers_with_balance: summary.with_balance,
                total_customers: total,
            },
            customers: customers.map((c) => ({
                id: c._id,
                vorname: c.vorname,
                nachname: c.nachname,
                email: c.email,
                balance: c.elaycoins?.balance ?? 0,
                studio: c.aktuelle_firma_id
                    ? {
                          id: c.aktuelle_firma_id._id,
                          firma: c.aktuelle_firma_id.firma,
                          studio_code: c.aktuelle_firma_id.studio_code,
                      }
                    : null,
                recent_transactions: (c.elaycoins?.transactions || [])
                    .slice()
                    .sort((a, b) => new Date(b.datum) - new Date(a.datum))
                    .slice(0, 8)
                    .map((t) => ({
                        id: t._id,
                        situationKey: t.situationKey,
                        label: t.label,
                        coins: t.coins,
                        typ: t.typ,
                        datum: t.datum,
                        herkunft_studio_id: t.herkunft_studio_id,
                        herkunft_studio_name: t.herkunft_studio_name,
                    })),
            })),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** POST /elaycoins/admin/adjust — credit or debit with audit tx */
const adminAdjustElaycoins = asyncHandler(async (req, res) => {
    const { customer_id, coins, reason } = req.body;
    if (!customer_id || typeof coins !== 'number' || !Number.isFinite(coins) || coins === 0) {
        throw new ApiError(400, 'customer_id and non-zero coins are required');
    }

    const customer = await Customer.findById(customer_id);
    if (!customer) throw new ApiError(404, 'Customer not found');

    if (!customer.elaycoins) {
        customer.elaycoins = { balance: 0, transactions: [], gesendete_warnungen: [] };
    }
    if (!Array.isArray(customer.elaycoins.transactions)) {
        customer.elaycoins.transactions = [];
    }

    const delta = Math.trunc(coins);
    customer.elaycoins.transactions.push({
        situationKey: 'admin_korrektur',
        label: reason ? `Admin: ${reason}` : 'Admin-Korrektur',
        kat: 'ADMIN',
        coins: delta,
        typ: delta < 0 ? 'malus' : 'reward',
        datum: new Date(),
        kontext: {
            admin_user_id: req.user.id || req.user._id,
            reason: reason || '',
        },
        herkunft_studio_id: customer.aktuelle_firma_id?.toString() || '',
        herkunft_studio_name: '',
    });
    customer.elaycoins.balance = Math.max(
        0,
        (customer.elaycoins.balance || 0) + delta
    );
    customer.markModified('elaycoins');
    await customer.save();

    const data = await getElaycoinData(customer._id, { forStudio: true });
    res.json({
        success: true,
        message: 'Elaycoins adjusted',
        data: { elaycoins: data },
    });
});

module.exports = {
    getMyElaycoins,
    getCustomerElaycoins,
    listStudioElaycoinOverview,
    listAdminElaycoinOverview,
    adminAdjustElaycoins,
};

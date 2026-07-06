const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const { getElaycoinData } = require('../utils/elaycoinEngine');
const { isCustomer, isStudio, isAdmin } = require('../utils/accessHelpers');
const { resolveStudioId } = require('../utils/studioScope');
const { USER_ROLES } = require('../config/constants');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

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
            .select('vorname nachname email elaycoins.balance akquise_quelle')
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
                akquise_quelle: c.akquise_quelle,
                balance: c.elaycoins?.balance ?? 0,
            })),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

module.exports = {
    getMyElaycoins,
    getCustomerElaycoins,
    listStudioElaycoinOverview,
};

const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Case = require('../models/caseModel');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const { getElaycoinData } = require('../utils/elaycoinEngine');
const { isCustomer, isStudio, isAdmin } = require('../utils/accessHelpers');
const { USER_ROLES } = require('../config/constants');

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
        const linked = await Case.exists({
            customer: customerId,
            studio: user.studio_id,
        });
        if (!linked) {
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

module.exports = {
    getMyElaycoins,
    getCustomerElaycoins,
};

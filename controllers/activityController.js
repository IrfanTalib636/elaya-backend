const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Customer = require('../models/customerModel');
const { resolveStudioId } = require('../utils/studioScope');
const { composeActivityFeed } = require('../utils/activityFeed');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { resolveStudioCustomerRelation } = require('../utils/accessHelpers');

const listStudioActivity = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const { customer_id, category, from, to } = req.query;
    const { page, limit } = parsePagination({ ...req.query, limit: req.query.limit || 50 });

    let customerScope = null;
    let includeAllCustomerStudios = false;

    if (customer_id) {
        if (!mongoose.isValidObjectId(customer_id)) {
            throw new ApiError(400, 'Invalid customer_id');
        }
        const customer = await Customer.findById(customer_id).select('aktuelle_firma_id firma_history').lean();
        if (!customer) throw new ApiError(404, 'Customer not found');
        const relation = resolveStudioCustomerRelation(studioId, customer);
        if (relation.wechsel_status === 'none') {
            throw new ApiError(403, 'You do not have access to this customer');
        }
        customerScope = customer_id;
        includeAllCustomerStudios = relation.is_current;
    }

    const { items, total } = await composeActivityFeed({
        studioId,
        customerId: customerScope,
        includeAllCustomerStudios,
        category: category && category !== 'all' ? category : null,
        from,
        to,
        page,
        limit,
    });

    res.status(200).json({
        success: true,
        data: {
            events: items,
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

module.exports = { listStudioActivity };

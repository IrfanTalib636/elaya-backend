const ShopOrder = require('../models/shopOrderModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { resolveStudioId } = require('../utils/studioScope');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { DEFAULT_SHOP_PROVISION_PROZENT } = require('../config/shopDefaults');

const formatShopOrder = (order) => ({
    id: order._id,
    order_number: order.order_number,
    customer_id: order.customer?._id ?? order.customer,
    kunden_name: order.customer
        ? `${order.customer.vorname ?? ''} ${order.customer.nachname ?? ''}`.trim()
        : '',
    produkte: order.produkte ?? [],
    total_chf: order.total_chf,
    versandkosten: order.versandkosten ?? 0,
    lieferland: order.lieferland ?? '',
    lieferadresse: order.lieferadresse ?? null,
    provision_prozent: order.provision_prozent ?? DEFAULT_SHOP_PROVISION_PROZENT,
    provision_betrag: order.provision_betrag ?? 0,
    zahlungsart: order.zahlungsart ?? '',
    zahlung_simuliert: order.zahlung_simuliert !== false,
    status: order.status,
    erstellt_am: order.createdAt,
});

/** GET /studio/shop/orders */
const listShopOrders = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const { page, limit, skip } = parsePagination(req.query);
    const { from, to, status } = req.query;

    const filter = { studio: studioId };
    if (status) filter.status = status;
    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) {
            const end = new Date(to);
            end.setHours(23, 59, 59, 999);
            filter.createdAt.$lte = end;
        }
    }

    const [orders, total] = await Promise.all([
        ShopOrder.find(filter)
            .populate('customer', 'vorname nachname email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ShopOrder.countDocuments(filter),
    ]);

    res.json({
        success: true,
        data: {
            orders: orders.map(formatShopOrder),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** PATCH /studio/shop/orders/:id — studio may only change shipping status */
const patchShopOrderStatus = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const order = await ShopOrder.findOne({ _id: req.params.id, studio: studioId });
    if (!order) throw new ApiError(404, 'Order not found');

    order.status = req.body.status;
    await order.save();
    await order.populate('customer', 'vorname nachname email');

    res.json({
        success: true,
        data: { order: formatShopOrder(order.toObject()) },
    });
});

module.exports = {
    listShopOrders,
    patchShopOrderStatus,
};

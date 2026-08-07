const ShopOrder = require('../models/shopOrderModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const mongoose = require('mongoose');
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
    elaya_anteil_chf: order.elaya_anteil_chf ?? 0,
    commission_status: order.commission_status ?? 'pending',
    commission_paid_at: order.commission_paid_at ?? null,
    elaycoins_redeemed: order.elaycoins_redeemed ?? 0,
    elaycoins_discount_chf: order.elaycoins_discount_chf ?? 0,
    zahlungsart: order.zahlungsart ?? '',
    zahlung_simuliert: order.zahlung_simuliert !== false,
    status: order.status,
    erstellt_am: order.createdAt,
});

/** GET /studio/shop/orders */
const listShopOrders = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const { page, limit, skip } = parsePagination(req.query);
    const { from, to, status, commission_status } = req.query;

    const filter = { studio: studioId };
    if (status) filter.status = status;
    if (commission_status) filter.commission_status = commission_status;
    if (from || to) {
        filter.createdAt = {};
        if (from) filter.createdAt.$gte = new Date(from);
        if (to) {
            const end = new Date(to);
            end.setHours(23, 59, 59, 999);
            filter.createdAt.$lte = end;
        }
    }

    const [orders, total, agg] = await Promise.all([
        ShopOrder.find(filter)
            .populate('customer', 'vorname nachname email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ShopOrder.countDocuments(filter),
        ShopOrder.aggregate([
            { $match: { studio: new mongoose.Types.ObjectId(String(studioId)) } },
            {
                $group: {
                    _id: null,
                    revenue: { $sum: '$total_chf' },
                    provision_total: { $sum: { $ifNull: ['$provision_betrag', 0] } },
                    pending_provision: {
                        $sum: {
                            $cond: [
                                { $eq: ['$commission_status', 'pending'] },
                                { $ifNull: ['$provision_betrag', 0] },
                                0,
                            ],
                        },
                    },
                    paid_provision: {
                        $sum: {
                            $cond: [
                                { $eq: ['$commission_status', 'paid'] },
                                { $ifNull: ['$provision_betrag', 0] },
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
    ]);

    const summary = agg[0] || {
        revenue: 0,
        provision_total: 0,
        pending_provision: 0,
        paid_provision: 0,
    };

    res.json({
        success: true,
        data: {
            orders: orders.map(formatShopOrder),
            summary: {
                revenue: summary.revenue ?? 0,
                provision_total: summary.provision_total ?? 0,
                pending_provision: summary.pending_provision ?? 0,
                paid_provision: summary.paid_provision ?? 0,
            },
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

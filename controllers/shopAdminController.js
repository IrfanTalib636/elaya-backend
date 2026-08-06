const ShopProduct = require('../models/shopProductModel');
const ShopOrder = require('../models/shopOrderModel');
const Studio = require('../models/studioModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { getPlatformConfig } = require('../utils/configService');
const {
    DEFAULT_SHOP_PROVISION_PROZENT,
    SHOP_CATEGORIES,
    DEFAULT_SHOP_SHIPPING,
    SHOP_COUNTRIES,
} = require('../config/shopDefaults');

const round2 = (n) => Math.round(n * 100) / 100;

const formatProduct = (doc) => ({
    id: doc._id.toString(),
    product_code: doc.product_code,
    artikelnummer: doc.artikelnummer,
    name: doc.name,
    beschreibung: doc.beschreibung ?? '',
    preis_chf: doc.preis_chf,
    kategorie: doc.kategorie,
    ean: doc.ean ?? '',
    ursprung: doc.ursprung ?? '',
    bild_url: doc.bild_url ?? '',
    lagerbestand: doc.lagerbestand,
    aktiv: doc.aktiv,
    sort_order: doc.sort_order ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
});

const formatAdminOrder = (order) => ({
    id: order._id,
    order_number: order.order_number,
    studio_id: order.studio?._id ?? order.studio,
    studio_name: order.studio?.firma ?? '',
    customer_id: order.customer?._id ?? order.customer,
    kunden_name: order.customer
        ? `${order.customer.vorname ?? ''} ${order.customer.nachname ?? ''}`.trim()
        : '',
    produkte: order.produkte ?? [],
    total_chf: order.total_chf,
    versandkosten: order.versandkosten ?? 0,
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

/** GET /admin/shop/products */
const listProductsAdmin = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.kategorie) filter.kategorie = req.query.kategorie;
    if (req.query.aktiv === 'true') filter.aktiv = true;
    if (req.query.aktiv === 'false') filter.aktiv = false;
    if (req.query.q) {
        const q = String(req.query.q).trim();
        filter.$or = [
            { name: new RegExp(q, 'i') },
            { artikelnummer: new RegExp(q, 'i') },
            { product_code: new RegExp(q, 'i') },
        ];
    }

    const [products, total] = await Promise.all([
        ShopProduct.find(filter).sort({ sort_order: 1, name: 1 }).skip(skip).limit(limit).lean(),
        ShopProduct.countDocuments(filter),
    ]);

    res.json({
        success: true,
        data: {
            products: products.map(formatProduct),
            categories: SHOP_CATEGORIES,
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** POST /admin/shop/products */
const createProduct = asyncHandler(async (req, res) => {
    const body = req.body;
    const exists = await ShopProduct.findOne({
        $or: [{ product_code: body.product_code }, { artikelnummer: body.artikelnummer }],
    });
    if (exists) throw new ApiError(409, 'product_code or artikelnummer already exists');

    const product = await ShopProduct.create(body);
    res.status(201).json({
        success: true,
        data: { product: formatProduct(product.toObject()) },
    });
});

/** PATCH /admin/shop/products/:id */
const updateProduct = asyncHandler(async (req, res) => {
    const product = await ShopProduct.findById(req.params.id);
    if (!product) throw new ApiError(404, 'Product not found');

    const fields = [
        'name',
        'beschreibung',
        'preis_chf',
        'kategorie',
        'ean',
        'ursprung',
        'bild_url',
        'lagerbestand',
        'aktiv',
        'sort_order',
        'product_code',
        'artikelnummer',
    ];
    for (const f of fields) {
        if (req.body[f] !== undefined) product[f] = req.body[f];
    }
    await product.save();

    res.json({
        success: true,
        data: { product: formatProduct(product.toObject()) },
    });
});

/** GET /admin/shop/orders */
const listOrdersAdmin = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.studio_id) filter.studio = req.query.studio_id;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.commission_status) filter.commission_status = req.query.commission_status;

    const [orders, total] = await Promise.all([
        ShopOrder.find(filter)
            .populate('customer', 'vorname nachname email')
            .populate('studio', 'firma studio_code')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ShopOrder.countDocuments(filter),
    ]);

    res.json({
        success: true,
        data: {
            orders: orders.map(formatAdminOrder),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** PATCH /admin/shop/orders/:id/commission — mark commission paid/pending; optional Stripe Transfer */
const patchOrderCommission = asyncHandler(async (req, res) => {
    const order = await ShopOrder.findById(req.params.id);
    if (!order) throw new ApiError(404, 'Order not found');

    const status = req.body.commission_status;
    if (!['pending', 'paid', 'cancelled'].includes(status)) {
        throw new ApiError(400, 'Invalid commission_status');
    }

    const payViaStripe = Boolean(req.body.pay_via_stripe) && status === 'paid';

    if (payViaStripe) {
        const {
            isStripeConfigured,
            createCommissionTransfer,
        } = require('../utils/stripeService');
        if (!isStripeConfigured()) {
            throw new ApiError(503, 'Stripe is not configured');
        }
        const studio = await Studio.findById(order.studio);
        if (!studio?.stripe_account_id) {
            throw new ApiError(400, 'Studio has no Stripe Connect account');
        }
        if (!studio.stripe_payouts_enabled && !studio.stripe_onboarding_complete) {
            throw new ApiError(400, 'Studio Stripe onboarding is incomplete');
        }
        if (order.stripe_transfer_id) {
            throw new ApiError(400, 'Commission already transferred via Stripe');
        }
        const amount = order.provision_betrag || 0;
        if (amount <= 0) {
            throw new ApiError(400, 'No commission amount to transfer');
        }
        try {
            const transfer = await createCommissionTransfer({
                amountChf: amount,
                destinationAccountId: studio.stripe_account_id,
                orderId: order._id,
                orderNumber: order.order_number,
            });
            order.stripe_transfer_id = transfer.id;
        } catch (err) {
            throw new ApiError(502, `Stripe transfer failed: ${err.message}`);
        }
    }

    order.commission_status = status;
    order.commission_paid_at = status === 'paid' ? new Date() : null;
    await order.save();
    await order.populate([
        { path: 'customer', select: 'vorname nachname email' },
        { path: 'studio', select: 'firma studio_code stripe_account_id' },
    ]);

    res.json({
        success: true,
        data: { order: formatAdminOrder(order.toObject()) },
    });
});

/** GET /admin/shop/finance — cross-studio shop revenue + commissions */
const getShopFinanceSummary = asyncHandler(async (req, res) => {
    const platform = await getPlatformConfig();
    const match = {};
    if (req.query.from || req.query.to) {
        match.createdAt = {};
        if (req.query.from) match.createdAt.$gte = new Date(req.query.from);
        if (req.query.to) {
            const end = new Date(req.query.to);
            end.setHours(23, 59, 59, 999);
            match.createdAt.$lte = end;
        }
    }

    const byStudio = await ShopOrder.aggregate([
        { $match: match },
        {
            $group: {
                _id: '$studio',
                order_count: { $sum: 1 },
                revenue: { $sum: '$total_chf' },
                provision_total: { $sum: { $ifNull: ['$provision_betrag', 0] } },
                elaya_total: { $sum: { $ifNull: ['$elaya_anteil_chf', 0] } },
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
        { $sort: { revenue: -1 } },
    ]);

    const studioIds = byStudio.map((r) => r._id).filter(Boolean);
    const studios = await Studio.find({ _id: { $in: studioIds } })
        .select('firma studio_code')
        .lean();
    const studioMap = Object.fromEntries(studios.map((s) => [s._id.toString(), s]));

    const studiosOut = byStudio.map((r) => {
        const s = studioMap[r._id?.toString()] || {};
        return {
            studio_id: r._id,
            studio_name: s.firma || '',
            studio_code: s.studio_code || '',
            order_count: r.order_count,
            revenue: round2(r.revenue),
            provision_total: round2(r.provision_total),
            elaya_total: round2(r.elaya_total),
            pending_provision: round2(r.pending_provision),
            paid_provision: round2(r.paid_provision),
        };
    });

    const totals = studiosOut.reduce(
        (acc, s) => {
            acc.order_count += s.order_count;
            acc.revenue = round2(acc.revenue + s.revenue);
            acc.provision_total = round2(acc.provision_total + s.provision_total);
            acc.elaya_total = round2(acc.elaya_total + s.elaya_total);
            acc.pending_provision = round2(acc.pending_provision + s.pending_provision);
            acc.paid_provision = round2(acc.paid_provision + s.paid_provision);
            return acc;
        },
        {
            order_count: 0,
            revenue: 0,
            provision_total: 0,
            elaya_total: 0,
            pending_provision: 0,
            paid_provision: 0,
        }
    );

    res.json({
        success: true,
        data: {
            provision_percent_default:
                platform.shop_provision_prozent ?? DEFAULT_SHOP_PROVISION_PROZENT,
            stripe_connect_enabled: Boolean(
                process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim()
            ),
            totals,
            studios: studiosOut,
            shipping: {
                countries: SHOP_COUNTRIES,
                rates: DEFAULT_SHOP_SHIPPING,
            },
        },
    });
});

/** GET /admin/shop/shipping */
const getShippingAdmin = asyncHandler(async (_req, res) => {
    res.json({
        success: true,
        data: {
            countries: SHOP_COUNTRIES,
            rates: DEFAULT_SHOP_SHIPPING,
            note: 'Shipping rates are currently platform defaults. Editable shipping config can be extended via platform_config.',
        },
    });
});

module.exports = {
    listProductsAdmin,
    createProduct,
    updateProduct,
    listOrdersAdmin,
    patchOrderCommission,
    getShopFinanceSummary,
    getShippingAdmin,
    formatProduct,
    formatAdminOrder,
};

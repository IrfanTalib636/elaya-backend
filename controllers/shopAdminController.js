const ShopProduct = require('../models/shopProductModel');
const ShopOrder = require('../models/shopOrderModel');
const Studio = require('../models/studioModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { getPlatformConfig } = require('../utils/configService');
const { USER_ROLES } = require('../config/constants');
const {
    DEFAULT_SHOP_PROVISION_PROZENT,
    SHOP_CATEGORIES,
    DEFAULT_SHOP_SHIPPING,
    SHOP_COUNTRIES,
} = require('../config/shopDefaults');

const round2 = (n) => Math.round(n * 100) / 100;

const resolveShopCategories = (platform) =>
    Array.isArray(platform?.shop_categories) && platform.shop_categories.length
        ? platform.shop_categories
        : SHOP_CATEGORIES;

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
    rabatt_prozent: doc.rabatt_prozent ?? 0,
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

    const [products, total, platform] = await Promise.all([
        ShopProduct.find(filter).sort({ sort_order: 1, name: 1 }).skip(skip).limit(limit).lean(),
        ShopProduct.countDocuments(filter),
        getPlatformConfig(),
    ]);

    res.json({
        success: true,
        data: {
            products: products.map(formatProduct),
            categories: resolveShopCategories(platform),
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

/** GET /admin/shop/finance — Reines Abo-Modell overview + shop ledger */
const getShopFinanceSummary = asyncHandler(async (req, res) => {
    const {
        getPlatformFinanceOverview,
    } = require('../utils/platformFinanceService');
    const data = await getPlatformFinanceOverview();
    res.json({ success: true, data });
});

/** GET /admin/shop/finance/studios/:studioId — dual P&L + products */
const getStudioFinanceDetail = asyncHandler(async (req, res) => {
    const {
        getStudioFinanceDetail: loadDetail,
    } = require('../utils/platformFinanceService');
    const data = await loadDetail(req.params.studioId);
    res.json({ success: true, data });
});

/** PATCH /admin/shop/finance/studios/:studioId — package / Sonderkonditionen */
const patchStudioFinanceTerms = asyncHandler(async (req, res) => {
    if (req.user.role !== USER_ROLES.SUPER_ADMIN) {
        throw new ApiError(403, 'Only super admin can change studio finance terms');
    }
    const {
        patchStudioFinanceTerms: patchTerms,
    } = require('../utils/platformFinanceService');
    const data = await patchTerms(req.params.studioId, req.body || {});
    const {
        logPlatformAudit,
        PLATFORM_AUDIT_ACTION,
    } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.STUDIO_CONFIG_PATCH || 'STUDIO_CONFIG_PATCH',
        targetType: 'studio',
        targetId: String(req.params.studioId),
        studioId: req.params.studioId,
        reason: req.body.override_grund || req.body.reason || 'Finance terms updated',
        after: {
            package_id: data.terms?.package_id,
            abo_chf: data.terms?.abo_chf,
            shop_provision_studio_prozent: data.terms?.shop_provision_studio_prozent,
        },
        ip: req.ip,
    });
    res.json({
        success: true,
        message: 'Studio finance terms updated',
        data,
    });
});

/** GET /admin/shop/shipping */
const getShippingAdmin = asyncHandler(async (_req, res) => {
    const platform = await getPlatformConfig();
    const rates = {
        ...DEFAULT_SHOP_SHIPPING,
        ...(platform.shop_shipping || {}),
    };
    const categories =
        Array.isArray(platform.shop_categories) && platform.shop_categories.length
            ? platform.shop_categories
            : SHOP_CATEGORIES;

    res.json({
        success: true,
        data: {
            countries: SHOP_COUNTRIES,
            rates,
            categories,
            shop_provision_prozent:
                platform.shop_provision_prozent ?? DEFAULT_SHOP_PROVISION_PROZENT,
        },
    });
});

/** PATCH /admin/shop/shipping — Super Admin editable shipping + categories */
const patchShopCatalogAdmin = asyncHandler(async (req, res) => {
    const { updatePlatformConfig } = require('../utils/configService');
    const payload = {};
    if (req.body.rates) payload.shop_shipping = req.body.rates;
    if (req.body.categories) payload.shop_categories = req.body.categories;
    if (req.body.shop_provision_prozent !== undefined) {
        payload.shop_provision_prozent = req.body.shop_provision_prozent;
    }
    if (!Object.keys(payload).length) {
        throw new ApiError(400, 'No shipping/catalog fields to update');
    }
    const config = await updatePlatformConfig(payload);
    res.json({
        success: true,
        message: 'Shop catalog settings updated',
        data: {
            rates: { ...DEFAULT_SHOP_SHIPPING, ...(config.shop_shipping || {}) },
            categories:
                Array.isArray(config.shop_categories) && config.shop_categories.length
                    ? config.shop_categories
                    : SHOP_CATEGORIES,
            shop_provision_prozent:
                config.shop_provision_prozent ?? DEFAULT_SHOP_PROVISION_PROZENT,
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
    getStudioFinanceDetail,
    patchStudioFinanceTerms,
    getShippingAdmin,
    patchShopCatalogAdmin,
    formatProduct,
    formatAdminOrder,
};

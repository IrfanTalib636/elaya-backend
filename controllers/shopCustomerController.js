const mongoose = require('mongoose');
const ShopProduct = require('../models/shopProductModel');
const ShopOrder = require('../models/shopOrderModel');
const Customer = require('../models/customerModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { isCustomer } = require('../utils/accessHelpers');
const { vergebeElaycoins } = require('../utils/elaycoinEngine');
const {
    DEFAULT_SHOP_PROVISION_PROZENT,
    DEFAULT_SHOP_SHIPPING,
    SHOP_COUNTRIES,
    calculateShipping,
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
});

const formatCustomerOrder = (order) => ({
    id: order._id,
    order_number: order.order_number,
    produkte: order.produkte ?? [],
    total_chf: order.total_chf,
    versandkosten: order.versandkosten ?? 0,
    brutto_chf: round2((order.total_chf ?? 0) + (order.versandkosten ?? 0)),
    lieferland: order.lieferland ?? '',
    lieferadresse: order.lieferadresse ?? null,
    zahlungsart: order.zahlungsart ?? '',
    zahlung_simuliert: order.zahlung_simuliert !== false,
    status: order.status,
    erstellt_am: order.createdAt,
});

const resolveProduct = async (produktId) => {
    if (mongoose.Types.ObjectId.isValid(produktId) && String(new mongoose.Types.ObjectId(produktId)) === String(produktId)) {
        return ShopProduct.findOne({ _id: produktId, aktiv: true });
    }
    return ShopProduct.findOne({
        aktiv: true,
        $or: [{ product_code: produktId }, { artikelnummer: produktId }],
    });
};

/** GET /shop/products */
const listProducts = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { aktiv: true };
    if (req.query.kategorie) filter.kategorie = req.query.kategorie;

    const [products, total] = await Promise.all([
        ShopProduct.find(filter).sort({ sort_order: 1, name: 1 }).skip(skip).limit(limit).lean(),
        ShopProduct.countDocuments(filter),
    ]);

    res.json({
        success: true,
        data: {
            products: products.map(formatProduct),
            categories: require('../config/shopDefaults').SHOP_CATEGORIES,
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** GET /shop/products/:id */
const getProduct = asyncHandler(async (req, res) => {
    const product = await resolveProduct(req.params.id);
    if (!product) throw new ApiError(404, 'Product not found');

    res.json({
        success: true,
        data: { product: formatProduct(product) },
    });
});

/** GET /shop/shipping */
const getShipping = asyncHandler(async (req, res) => {
    const land = req.query.land || 'Schweiz';
    const warenwert = Number(req.query.warenwert) || 0;
    const quote = calculateShipping(land, warenwert);

    res.json({
        success: true,
        data: {
            shipping: {
                countries: SHOP_COUNTRIES,
                rates: Object.fromEntries(
                    SHOP_COUNTRIES.map((c) => [c, DEFAULT_SHOP_SHIPPING[c]])
                ),
                gratis_ab_ch: DEFAULT_SHOP_SHIPPING.gratis_ab_ch,
                gratis_ab_eu: DEFAULT_SHOP_SHIPPING.gratis_ab_eu,
                quote: {
                    land: quote.land,
                    warenwert,
                    versandkosten: quote.versandkosten,
                    gratis: quote.gratis,
                },
            },
        },
    });
});

const nextOrderNumber = async () => {
    const count = await ShopOrder.countDocuments();
    return `ELY-ORD-${String(count + 1).padStart(4, '0')}`;
};

/** POST /shop/orders — customer checkout (cart is client-side) */
const createOrder = asyncHandler(async (req, res) => {
    if (!isCustomer(req.user.role) || !req.user.customer_id) {
        throw new ApiError(403, 'Only customers can place shop orders');
    }

    const customer = await Customer.findById(req.user.customer_id);
    if (!customer) throw new ApiError(404, 'Customer not found');
    if (!customer.aktuelle_firma_id) {
        throw new ApiError(400, 'Customer has no studio assignment');
    }

    const { items, lieferadresse, zahlungsart } = req.body;
    const lineItems = [];
    let warenwert = 0;

    for (const item of items) {
        const product = await resolveProduct(item.produkt_id);
        if (!product) {
            throw new ApiError(400, `Product not found or inactive: ${item.produkt_id}`);
        }
        const menge = item.menge;
        const line = round2(product.preis_chf * menge);
        warenwert = round2(warenwert + line);
        lineItems.push({
            produkt_id: product._id.toString(),
            produkt_name: product.name,
            menge,
            preis_chf: product.preis_chf,
        });
    }

    const { versandkosten, land } = calculateShipping(lieferadresse.land, warenwert);
    const provision_prozent = DEFAULT_SHOP_PROVISION_PROZENT;
    const provision_betrag = round2(warenwert * (provision_prozent / 100));

    const order = await ShopOrder.create({
        studio: customer.aktuelle_firma_id,
        customer: customer._id,
        order_number: await nextOrderNumber(),
        produkte: lineItems,
        total_chf: warenwert,
        versandkosten,
        lieferland: land,
        lieferadresse: {
            ...lieferadresse,
            land,
        },
        provision_prozent,
        provision_betrag,
        zahlungsart,
        zahlung_simuliert: true,
    });

    // Coin rewards — non-blocking (prototype TODO)
    try {
        await vergebeElaycoins(customer._id, 'erster_einkauf', {
            order_id: order._id.toString(),
        });
        await vergebeElaycoins(customer._id, 'nachsorge_produkt_gekauft', {
            order_id: order._id.toString(),
        });
    } catch (err) {
        console.error('[shop] elaycoin award failed', err.message);
    }

    res.status(201).json({
        success: true,
        message: 'Order placed successfully (payment simulated)',
        data: {
            order: formatCustomerOrder(order.toObject()),
        },
    });
});

/** GET /shop/orders — customer's own orders */
const listMyOrders = asyncHandler(async (req, res) => {
    if (!isCustomer(req.user.role) || !req.user.customer_id) {
        throw new ApiError(403, 'Only customers can list their shop orders');
    }

    const { page, limit, skip } = parsePagination(req.query);
    const filter = { customer: req.user.customer_id };

    const [orders, total] = await Promise.all([
        ShopOrder.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        ShopOrder.countDocuments(filter),
    ]);

    res.json({
        success: true,
        data: {
            orders: orders.map(formatCustomerOrder),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** GET /shop/orders/:id */
const getMyOrder = asyncHandler(async (req, res) => {
    if (!isCustomer(req.user.role) || !req.user.customer_id) {
        throw new ApiError(403, 'Only customers can view shop orders');
    }

    const order = await ShopOrder.findOne({
        _id: req.params.id,
        customer: req.user.customer_id,
    }).lean();

    if (!order) throw new ApiError(404, 'Order not found');

    res.json({
        success: true,
        data: { order: formatCustomerOrder(order) },
    });
});

module.exports = {
    listProducts,
    getProduct,
    getShipping,
    createOrder,
    listMyOrders,
    getMyOrder,
    formatProduct,
    formatCustomerOrder,
};

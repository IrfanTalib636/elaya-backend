const mongoose = require('mongoose');
const ShopProduct = require('../models/shopProductModel');
const ShopOrder = require('../models/shopOrderModel');
const Customer = require('../models/customerModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { isCustomer } = require('../utils/accessHelpers');
const { vergebeElaycoins, zieheElaycoinsAb } = require('../utils/elaycoinEngine');
const { getPlatformConfig, resolveEffectiveCoinWert } = require('../utils/configService');
const {
    DEFAULT_SHOP_PROVISION_PROZENT,
    DEFAULT_SHOP_SHIPPING,
    SHOP_COUNTRIES,
    calculateShipping,
} = require('../config/shopDefaults');
const {
    isStripeConfigured,
    isStripeTestMode,
    getPublishableKey,
    createShopPaymentIntent,
    confirmPaymentIntentTest,
    retrievePaymentIntent,
} = require('../utils/stripeService');

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
    brutto_chf: round2(
        (order.total_chf ?? 0) +
            (order.versandkosten ?? 0) -
            (order.elaycoins_discount_chf ?? 0)
    ),
    lieferland: order.lieferland ?? '',
    lieferadresse: order.lieferadresse ?? null,
    zahlungsart: order.zahlungsart ?? '',
    zahlung_simuliert: order.zahlung_simuliert !== false,
    payment_status: order.payment_status ?? (order.zahlung_simuliert === false ? 'requires_payment' : 'paid'),
    stripe_payment_intent_id: order.stripe_payment_intent_id || '',
    elaycoins_redeemed: order.elaycoins_redeemed ?? 0,
    elaycoins_discount_chf: order.elaycoins_discount_chf ?? 0,
    status: order.status,
    erstellt_am: order.createdAt,
    paid_at: order.paid_at ?? null,
});

const resolveProduct = async (produktId) => {
    if (
        mongoose.Types.ObjectId.isValid(produktId) &&
        String(new mongoose.Types.ObjectId(produktId)) === String(produktId)
    ) {
        return ShopProduct.findOne({ _id: produktId, aktiv: true });
    }
    return ShopProduct.findOne({
        $or: [{ product_code: produktId }, { artikelnummer: produktId }],
        aktiv: true,
    });
};

const nextOrderNumber = async () => {
    const count = await ShopOrder.countDocuments();
    const n = String(count + 1).padStart(5, '0');
    return `ES-${n}`;
};

/** Decrement stock + apply/award coins once payment is confirmed. Idempotent via payment_status. */
const fulfillPaidOrder = async (orderDoc, { simulated = false } = {}) => {
    const id = orderDoc._id || orderDoc.id;

    const fresh = await ShopOrder.findById(id);
    if (!fresh) return null;
    if (fresh.payment_status === 'paid' && fresh.paid_at) {
        return fresh;
    }

    fresh.payment_status = 'paid';
    fresh.zahlung_simuliert = simulated;
    fresh.paid_at = fresh.paid_at || new Date();
    await fresh.save();

    for (const item of fresh.produkte || []) {
        if (!item.produkt_id) continue;
        const product = await ShopProduct.findById(item.produkt_id);
        if (product && product.lagerbestand != null) {
            product.lagerbestand = Math.max(0, product.lagerbestand - item.menge);
            await product.save();
        }
    }

    const customerId = fresh.customer;
    const studioId = fresh.studio?.toString?.() || fresh.studio;
    const coinsToRedeem = fresh.elaycoins_redeemed || 0;

    if (coinsToRedeem > 0) {
        try {
            await zieheElaycoinsAb(
                customerId,
                'shop_einloesung',
                {
                    order_id: fresh._id.toString(),
                    herkunft_studio_id: studioId,
                    coins: coinsToRedeem,
                },
                { amountOverride: coinsToRedeem }
            );
        } catch (err) {
            console.error('[shop] elaycoin redeem failed', err.message);
        }
    }

    try {
        await vergebeElaycoins(customerId, 'erster_einkauf', {
            order_id: fresh._id.toString(),
            herkunft_studio_id: studioId,
        });
        await vergebeElaycoins(customerId, 'nachsorge_produkt_gekauft', {
            order_id: fresh._id.toString(),
            herkunft_studio_id: studioId,
        });
    } catch (err) {
        console.error('[shop] elaycoin award failed', err.message);
    }

    return fresh;
};

/** GET /shop/config — public-ish shop payment config for clients */
const getShopPaymentConfig = asyncHandler(async (_req, res) => {
    res.json({
        success: true,
        data: {
            stripe_enabled: isStripeConfigured(),
            stripe_test_mode: isStripeTestMode(),
            publishable_key: isStripeConfigured() ? getPublishableKey() : null,
            currency: (process.env.STRIPE_CURRENCY || 'chf').toLowerCase(),
        },
    });
});

/** GET /shop/products */
const listProducts = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = { aktiv: true };
    if (req.query.kategorie) filter.kategorie = req.query.kategorie;

    const [products, total] = await Promise.all([
        ShopProduct.find(filter).sort({ name: 1 }).skip(skip).limit(limit).lean(),
        ShopProduct.countDocuments(filter),
    ]);

    const categories = await ShopProduct.distinct('kategorie', { aktiv: true });

    res.json({
        success: true,
        data: {
            products: products.map(formatProduct),
            categories,
            pagination: buildPaginationMeta(page, limit, total),
            shipping: {
                countries: SHOP_COUNTRIES,
                rates: DEFAULT_SHOP_SHIPPING,
            },
        },
    });
});

const getProduct = asyncHandler(async (req, res) => {
    const product = await resolveProduct(req.params.id);
    if (!product) throw new ApiError(404, 'Product not found');
    res.json({ success: true, data: { product: formatProduct(product) } });
});

const getShipping = asyncHandler(async (req, res) => {
    const land = req.query.land || 'Schweiz';
    const warenwert = Number(req.query.warenwert) || 0;
    const { versandkosten, land: resolvedLand, gratis } = calculateShipping(land, warenwert);
    res.json({
        success: true,
        data: {
            shipping: {
                countries: SHOP_COUNTRIES,
                rates: DEFAULT_SHOP_SHIPPING,
                gratis_ab_ch: DEFAULT_SHOP_SHIPPING.gratis_ab_ch ?? 75,
                gratis_ab_eu: DEFAULT_SHOP_SHIPPING.gratis_ab_eu ?? 150,
                quote: {
                    land: resolvedLand,
                    warenwert,
                    versandkosten,
                    gratis,
                },
            },
        },
    });
});

/** POST /shop/orders — create order; Stripe PaymentIntent when keys configured */
const createOrder = asyncHandler(async (req, res) => {
    if (!isCustomer(req.user.role) || !req.user.customer_id) {
        throw new ApiError(403, 'Only customers can place shop orders');
    }

    const customer = await Customer.findById(req.user.customer_id);
    if (!customer) throw new ApiError(404, 'Customer not found');
    if (!customer.aktuelle_firma_id) {
        throw new ApiError(400, 'Customer has no studio assignment');
    }

    const { items, lieferadresse, zahlungsart, elaycoins_to_redeem } = req.body;
    const lineItems = [];
    let warenwert = 0;

    for (const item of items) {
        const product = await resolveProduct(item.produkt_id);
        if (!product) {
            throw new ApiError(400, `Product not found or inactive: ${item.produkt_id}`);
        }
        if (product.lagerbestand != null && product.lagerbestand < item.menge) {
            throw new ApiError(400, `Insufficient stock for ${product.name}`);
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
    const platform = await getPlatformConfig();
    const provision_prozent =
        platform.shop_provision_prozent ?? DEFAULT_SHOP_PROVISION_PROZENT;
    const provision_betrag = round2(warenwert * (provision_prozent / 100));
    const elaya_anteil_chf = round2(warenwert - provision_betrag);

    const coinWert = await resolveEffectiveCoinWert(customer.aktuelle_firma_id);
    const deckelPct = platform.deckelProzent ?? 20;
    const maxDiscountChf = round2(warenwert * (deckelPct / 100));
    const requestedCoins = Math.max(0, Math.floor(Number(elaycoins_to_redeem) || 0));
    const balance = customer.elaycoins?.balance ?? 0;
    const maxCoinsByDeckel = coinWert > 0 ? Math.floor(maxDiscountChf / coinWert) : 0;
    const coinsToRedeem = Math.min(requestedCoins, balance, maxCoinsByDeckel);
    const elaycoins_discount_chf = round2(coinsToRedeem * coinWert);

    const brutto = round2(warenwert + versandkosten - elaycoins_discount_chf);
    const useStripe = isStripeConfigured() && brutto >= 0.5;

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
        elaya_anteil_chf,
        commission_status: 'pending',
        elaycoins_redeemed: coinsToRedeem,
        elaycoins_discount_chf,
        zahlungsart,
        zahlung_simuliert: !useStripe,
        payment_status: useStripe ? 'requires_payment' : 'pending',
        paid_at: null,
    });

    let payment = null;

    if (useStripe) {
        try {
            const pi = await createShopPaymentIntent({
                amountChf: brutto,
                orderId: order._id,
                orderNumber: order.order_number,
                customerEmail: customer.email,
                metadata: {
                    studio_id: String(customer.aktuelle_firma_id),
                    customer_id: String(customer._id),
                },
            });
            order.stripe_payment_intent_id = pi.id;
            await order.save();
            payment = {
                client_secret: pi.client_secret,
                payment_intent_id: pi.id,
                publishable_key: getPublishableKey(),
                test_mode: isStripeTestMode(),
                amount_chf: brutto,
                currency: (process.env.STRIPE_CURRENCY || 'chf').toLowerCase(),
            };
        } catch (err) {
            console.error('[shop] PaymentIntent create failed', err.message);
            await ShopOrder.deleteOne({ _id: order._id });
            throw new ApiError(502, `Stripe payment init failed: ${err.message}`);
        }
    } else {
        // Legacy simulated path when Stripe keys are absent
        await fulfillPaidOrder(order, { simulated: true });
    }

    res.status(201).json({
        success: true,
        message: useStripe
            ? 'Order created — complete payment with Stripe'
            : 'Order placed successfully (payment simulated — Stripe not configured)',
        data: {
            order: formatCustomerOrder(order.toObject()),
            payment,
            stripe_enabled: useStripe,
        },
    });
});

/**
 * POST /shop/orders/:id/confirm-payment
 * Body: { test_confirm?: true } — test mode only, charges with pm_card_visa
 * Or after client-side confirm: { payment_intent_id }
 */
const confirmOrderPayment = asyncHandler(async (req, res) => {
    if (!isCustomer(req.user.role) || !req.user.customer_id) {
        throw new ApiError(403, 'Only customers can confirm shop payments');
    }
    if (!isStripeConfigured()) {
        throw new ApiError(400, 'Stripe is not configured');
    }

    const order = await ShopOrder.findOne({
        _id: req.params.id,
        customer: req.user.customer_id,
    });
    if (!order) throw new ApiError(404, 'Order not found');

    if (order.payment_status === 'paid') {
        return res.json({
            success: true,
            message: 'Order already paid',
            data: { order: formatCustomerOrder(order.toObject()) },
        });
    }

    if (!order.stripe_payment_intent_id) {
        throw new ApiError(400, 'Order has no Stripe PaymentIntent');
    }

    let pi;
    if (req.body?.test_confirm) {
        if (!isStripeTestMode()) {
            throw new ApiError(400, 'test_confirm only works with Stripe test keys');
        }
        pi = await confirmPaymentIntentTest(order.stripe_payment_intent_id);
    } else {
        pi = await retrievePaymentIntent(order.stripe_payment_intent_id);
    }

    if (pi.status !== 'succeeded') {
        order.payment_status = 'failed';
        await order.save();
        throw new ApiError(
            402,
            `Payment not completed (status: ${pi.status}). Use Stripe Payment Sheet or test_confirm in test mode.`
        );
    }

    const fulfilled = await fulfillPaidOrder(order);

    res.json({
        success: true,
        message: 'Payment confirmed',
        data: {
            order: formatCustomerOrder(fulfilled.toObject()),
            payment_intent_status: pi.status,
        },
    });
});

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
    getShopPaymentConfig,
    listProducts,
    getProduct,
    getShipping,
    createOrder,
    confirmOrderPayment,
    listMyOrders,
    getMyOrder,
    formatProduct,
    formatCustomerOrder,
    fulfillPaidOrder,
};

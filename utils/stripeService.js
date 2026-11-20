const Stripe = require('stripe');

let _stripe = null;
let _stripeKeyUsed = null;

const isStripeConfigured = () =>
    Boolean(process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim());

const isStripeTestMode = () =>
    String(process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');

const getPublishableKey = () =>
    String(process.env.STRIPE_PUBLISHABLE_KEY || '').trim() || null;

const getCurrency = () =>
    String(process.env.STRIPE_CURRENCY || 'chf').toLowerCase();

/** CHF → integer Rappen / cents for Stripe */
const toStripeAmount = (chf) => Math.round(Number(chf || 0) * 100);

const getStripe = () => {
    const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!key) {
        return null;
    }
    // Recreate client if env keys were rotated without process restart.
    if (!_stripe || _stripeKeyUsed !== key) {
        _stripe = new Stripe(key);
        _stripeKeyUsed = key;
    }
    return _stripe;
};

/**
 * Create a PaymentIntent for a shop order (platform collects full amount).
 * Studio commission is paid out later via Connect Transfer.
 */
const createShopPaymentIntent = async ({
    amountChf,
    orderId,
    orderNumber,
    customerEmail,
    metadata = {},
}) => {
    const stripe = getStripe();
    if (!stripe) {
        throw new Error('Stripe is not configured');
    }
    const amount = toStripeAmount(amountChf);
    if (amount < 50) {
        // Stripe CHF minimum is typically 0.50
        throw new Error('Order amount too low for Stripe payment');
    }

    return stripe.paymentIntents.create({
        amount,
        currency: getCurrency(),
        automatic_payment_methods: { enabled: true },
        receipt_email: customerEmail || undefined,
        metadata: {
            order_id: String(orderId),
            order_number: String(orderNumber || ''),
            ...metadata,
        },
        description: `ElayShop ${orderNumber || orderId}`,
    });
};

/** Confirm PaymentIntent with a Stripe test payment method (test mode only). */
const confirmPaymentIntentTest = async (paymentIntentId) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');
    if (!isStripeTestMode()) {
        throw new Error('test_confirm is only allowed with sk_test_ keys');
    }
    return stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: 'pm_card_visa',
        return_url: `${process.env.APP_FRONTEND_URL || 'http://localhost:5173'}/shop/payment-return`,
    });
};

const retrievePaymentIntent = async (paymentIntentId) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');
    return stripe.paymentIntents.retrieve(paymentIntentId);
};

const constructWebhookEvent = (rawBody, signature) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    }
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
};

const wrapStripeError = (err) => {
    const message = String(err?.message || 'Stripe request failed');
    const statusCode = Number(err?.statusCode) || 502;
    const out = new Error(message);
    out.statusCode = statusCode >= 400 && statusCode < 600 ? statusCode : 502;
    out.code = err?.code || undefined;
    out.type = err?.type || err?.rawType || 'StripeError';

    if (/signed up for Connect/i.test(message) || /Connect.*dashboard\.stripe\.com\/connect/i.test(message)) {
        out.code = 'STRIPE_CONNECT_NOT_ENABLED';
        out.statusCode = 503;
        out.message =
            'Stripe Connect is not enabled on the platform Stripe account. ' +
            'Open https://dashboard.stripe.com/connect (Test mode), complete Connect signup, then retry.';
    }

    return out;
};

const createConnectExpressAccount = async ({ email, studioId, firma }) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');
    try {
        return await stripe.accounts.create({
            type: 'express',
            country: 'CH',
            email: email || undefined,
            capabilities: {
                transfers: { requested: true },
                card_payments: { requested: true },
            },
            business_type: 'company',
            metadata: {
                studio_id: String(studioId),
                firma: String(firma || ''),
            },
        });
    } catch (err) {
        throw wrapStripeError(err);
    }
};

const createAccountLink = async ({ accountId, refreshUrl, returnUrl }) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');
    try {
        return await stripe.accountLinks.create({
            account: accountId,
            refresh_url: refreshUrl,
            return_url: returnUrl,
            type: 'account_onboarding',
        });
    } catch (err) {
        throw wrapStripeError(err);
    }
};

const retrieveConnectAccount = async (accountId) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');
    try {
        return await stripe.accounts.retrieve(accountId);
    } catch (err) {
        throw wrapStripeError(err);
    }
};

/** Transfer studio commission (provision) to connected Express account. */
const createCommissionTransfer = async ({
    amountChf,
    destinationAccountId,
    orderId,
    orderNumber,
}) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Stripe is not configured');
    const amount = toStripeAmount(amountChf);
    if (amount < 1) {
        throw new Error('Transfer amount too low');
    }
    return stripe.transfers.create({
        amount,
        currency: getCurrency(),
        destination: destinationAccountId,
        metadata: {
            order_id: String(orderId),
            order_number: String(orderNumber || ''),
            type: 'studio_shop_commission',
        },
        description: `ElayShop commission ${orderNumber || orderId}`,
    });
};

module.exports = {
    isStripeConfigured,
    isStripeTestMode,
    getPublishableKey,
    getCurrency,
    toStripeAmount,
    getStripe,
    createShopPaymentIntent,
    confirmPaymentIntentTest,
    retrievePaymentIntent,
    constructWebhookEvent,
    createConnectExpressAccount,
    createAccountLink,
    retrieveConnectAccount,
    createCommissionTransfer,
    wrapStripeError,
};

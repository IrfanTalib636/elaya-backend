const ShopOrder = require('../models/shopOrderModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
    isStripeConfigured,
    constructWebhookEvent,
} = require('../utils/stripeService');
const { fulfillPaidOrder } = require('./shopCustomerController');

/**
 * POST /stripe/webhook — raw body required (mounted in server.js before express.json).
 */
const handleStripeWebhook = asyncHandler(async (req, res) => {
    if (!isStripeConfigured()) {
        throw new ApiError(503, 'Stripe is not configured');
    }

    const signature = req.headers['stripe-signature'];
    if (!signature) {
        throw new ApiError(400, 'Missing stripe-signature header');
    }

    let event;
    try {
        event = constructWebhookEvent(req.body, signature);
    } catch (err) {
        console.error('[stripe webhook] signature verification failed', err.message);
        throw new ApiError(400, `Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object;
        const orderId = pi.metadata?.order_id;
        if (orderId) {
            const order = await ShopOrder.findById(orderId);
            if (order && order.payment_status !== 'paid') {
                await fulfillPaidOrder(order);
            }
        }
    }

    if (event.type === 'payment_intent.payment_failed') {
        const pi = event.data.object;
        const orderId = pi.metadata?.order_id;
        if (orderId) {
            await ShopOrder.updateOne(
                { _id: orderId, payment_status: { $ne: 'paid' } },
                { $set: { payment_status: 'failed' } }
            );
        }
    }

    res.json({ received: true });
});

module.exports = { handleStripeWebhook };

const Studio = require('../models/studioModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { isStudio, isAdmin } = require('../utils/accessHelpers');
const { resolveStudioId } = require('../utils/studioScope');
const {
    isStripeConfigured,
    isStripeTestMode,
    getPublishableKey,
    createConnectExpressAccount,
    createAccountLink,
    retrieveConnectAccount,
} = require('../utils/stripeService');

const frontendBase = () =>
    (process.env.APP_FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

const syncStudioFromAccount = async (studio, account) => {
    studio.stripe_account_id = account.id;
    studio.stripe_charges_enabled = Boolean(account.charges_enabled);
    studio.stripe_payouts_enabled = Boolean(account.payouts_enabled);
    studio.stripe_onboarding_complete = Boolean(
        account.details_submitted && account.charges_enabled
    );
    await studio.save();
    return studio;
};

const formatStripeStatus = (studio) => ({
    stripe_enabled: isStripeConfigured(),
    stripe_test_mode: isStripeTestMode(),
    publishable_key: isStripeConfigured() ? getPublishableKey() : null,
    account_id: studio.stripe_account_id || null,
    onboarding_complete: Boolean(studio.stripe_onboarding_complete),
    charges_enabled: Boolean(studio.stripe_charges_enabled),
    payouts_enabled: Boolean(studio.stripe_payouts_enabled),
});

/** GET /studio/stripe/status */
const getStripeStatus = asyncHandler(async (req, res) => {
    if (!isStudio(req.user.role) && !isAdmin(req.user.role)) {
        throw new ApiError(403, 'Studio or admin only');
    }
    const studioId = resolveStudioId(req);
    const studio = await Studio.findById(studioId);
    if (!studio) throw new ApiError(404, 'Studio not found');

    if (studio.stripe_account_id && isStripeConfigured()) {
        try {
            const account = await retrieveConnectAccount(studio.stripe_account_id);
            await syncStudioFromAccount(studio, account);
        } catch (err) {
            console.error('[stripe] account retrieve failed', err.message);
        }
    }

    res.json({
        success: true,
        data: formatStripeStatus(studio),
    });
});

/** POST /studio/stripe/connect — create Express account + onboarding link */
const startStripeConnect = asyncHandler(async (req, res) => {
    if (!isStudio(req.user.role)) {
        throw new ApiError(403, 'Only studio accounts can connect Stripe');
    }
    if (!isStripeConfigured()) {
        throw new ApiError(503, 'Stripe is not configured on the server');
    }

    const studioId = resolveStudioId(req);
    const studio = await Studio.findById(studioId);
    if (!studio) throw new ApiError(404, 'Studio not found');

    if (!studio.stripe_account_id) {
        const account = await createConnectExpressAccount({
            email: studio.email,
            studioId: studio._id,
            firma: studio.firma,
        });
        studio.stripe_account_id = account.id;
        await studio.save();
    }

    const returnUrl = `${frontendBase()}/studio/settings?tab=stripe&stripe=return`;
    const refreshUrl = `${frontendBase()}/studio/settings?tab=stripe&stripe=refresh`;

    const link = await createAccountLink({
        accountId: studio.stripe_account_id,
        refreshUrl,
        returnUrl,
    });

    res.json({
        success: true,
        data: {
            url: link.url,
            account_id: studio.stripe_account_id,
            expires_at: link.expires_at,
        },
    });
});

/** POST /studio/stripe/refresh — refresh status after onboarding return */
const refreshStripeConnect = asyncHandler(async (req, res) => {
    if (!isStudio(req.user.role) && !isAdmin(req.user.role)) {
        throw new ApiError(403, 'Studio or admin only');
    }
    if (!isStripeConfigured()) {
        throw new ApiError(503, 'Stripe is not configured');
    }

    const studioId = resolveStudioId(req);
    const studio = await Studio.findById(studioId);
    if (!studio) throw new ApiError(404, 'Studio not found');
    if (!studio.stripe_account_id) {
        throw new ApiError(400, 'Studio has no Stripe account yet');
    }

    const account = await retrieveConnectAccount(studio.stripe_account_id);
    await syncStudioFromAccount(studio, account);

    res.json({
        success: true,
        data: formatStripeStatus(studio),
    });
});

module.exports = {
    getStripeStatus,
    startStripeConnect,
    refreshStripeConnect,
};

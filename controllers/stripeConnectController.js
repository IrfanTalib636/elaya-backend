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

const frontendBase = (req) => {
    const configured = String(
        process.env.STUDIO_FRONTEND_URL ||
            process.env.APP_STUDIO_URL ||
            process.env.APP_FRONTEND_URL ||
            ''
    )
        .trim()
        .replace(/\/$/, '');
    if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) {
        return configured;
    }

    const origin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
    if (origin && /^https?:\/\//i.test(origin)) {
        return origin;
    }

    return configured || 'http://localhost:5173';
};

const throwAsApiError = (err) => {
    if (err instanceof ApiError) throw err;
    const status = Number(err?.statusCode) || 502;
    throw new ApiError(
        status >= 400 && status < 600 ? status : 502,
        err?.message || 'Stripe request failed'
    );
};

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

    try {
        if (!studio.stripe_account_id) {
            const account = await createConnectExpressAccount({
                email: studio.email,
                studioId: studio._id,
                firma: studio.firma,
            });
            studio.stripe_account_id = account.id;
            await studio.save();
        }

        const base = frontendBase(req);
        const returnUrl = `${base}/studio/settings?tab=stripe&stripe=return`;
        const refreshUrl = `${base}/studio/settings?tab=stripe&stripe=refresh`;

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
    } catch (err) {
        throwAsApiError(err);
    }
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

    try {
        const account = await retrieveConnectAccount(studio.stripe_account_id);
        await syncStudioFromAccount(studio, account);
    } catch (err) {
        throwAsApiError(err);
    }

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

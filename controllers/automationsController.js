const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Customer = require('../models/customerModel');
const { USER_ROLES } = require('../config/constants');
const { checkAutomationsForCustomer } = require('../utils/automationsRuntime');
const {
    getPlatformConfig,
    mergeEffectiveAutomations,
} = require('../utils/configService');
const Studio = require('../models/studioModel');
const { normalizePreferredLang } = require('../utils/preferredLanguage');

/**
 * POST /automations/me/check — customer app open: evaluate due automation messages.
 */
const checkMyAutomations = asyncHandler(async (req, res) => {
    if (req.user.role !== USER_ROLES.CUSTOMER || !req.user.customer_id) {
        throw new ApiError(403, 'Customers only');
    }
    const lang =
        normalizePreferredLang(req.query.lang) ||
        normalizePreferredLang(req.user.preferred_language) ||
        'de';
    const result = await checkAutomationsForCustomer(
        req.user.customer_id,
        req.user._id || req.user.id,
        { lang }
    );
    res.status(200).json({
        success: true,
        data: result,
    });
});

/**
 * GET /automations/me — effective active rules for the customer's studio (read-only).
 */
const getMyAutomations = asyncHandler(async (req, res) => {
    if (req.user.role !== USER_ROLES.CUSTOMER || !req.user.customer_id) {
        throw new ApiError(403, 'Customers only');
    }
    const customer = await Customer.findById(req.user.customer_id).select('aktuelle_firma_id');
    if (!customer) {
        throw new ApiError(404, 'Customer profile not found');
    }
    const [platform, studio] = await Promise.all([
        getPlatformConfig(),
        Studio.findById(customer.aktuelle_firma_id)
            .select('automatisierungen_overrides')
            .lean(),
    ]);
    const effective = mergeEffectiveAutomations(
        platform,
        studio?.automatisierungen_overrides || {}
    );
    res.status(200).json({
        success: true,
        data: { automatisierungen: effective },
    });
});

module.exports = {
    checkMyAutomations,
    getMyAutomations,
};

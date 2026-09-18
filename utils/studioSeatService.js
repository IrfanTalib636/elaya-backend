const User = require('../models/userModel');
const Studio = require('../models/studioModel');
const ApiError = require('./ApiError');
const { getPlatformConfig } = require('./configService');
const { USER_ROLES, USER_STATUS } = require('../config/constants');
const { PLATFORM_CONFIG_DEFAULTS } = require('../config/platformDefaults');
const { SUBSCRIPTION_PLAN_KEYS } = require('../config/featureCatalog');

const STUDIO_LOGIN_ROLES = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];

const getSeatLimitForPlan = (platform, planKey) => {
    const limits = {
        ...PLATFORM_CONFIG_DEFAULTS.subscription_seat_limits,
        ...(platform?.subscription_seat_limits || {}),
    };
    const key = SUBSCRIPTION_PLAN_KEYS.includes(planKey) ? planKey : 'professional';
    const raw = limits[key];
    if (raw === null || raw === undefined) return null; // unlimited
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

const countActiveStudioLogins = async (studioId) =>
    User.countDocuments({
        studio_id: studioId,
        role: { $in: STUDIO_LOGIN_ROLES },
        status: USER_STATUS.AKTIV,
    });

const getStudioSeatStatus = async (studioId) => {
    const studio = await Studio.findById(studioId).select('subscription_plan firma').lean();
    if (!studio) throw new ApiError(404, 'Studio not found');
    const platform = await getPlatformConfig();
    const plan = studio.subscription_plan || 'professional';
    const limit = getSeatLimitForPlan(platform, plan);
    const used = await countActiveStudioLogins(studioId);
    const unlimited = limit === null;
    return {
        studio_id: String(studioId),
        plan,
        limit,
        used,
        remaining: unlimited ? null : Math.max(0, limit - used),
        unlimited,
        at_limit: !unlimited && used >= limit,
        can_invite: unlimited || used < limit,
    };
};

/**
 * Throws 403 with upgrade hint when the studio cannot add another active login.
 */
const assertCanInviteStudioLogin = async (studioId) => {
    const status = await getStudioSeatStatus(studioId);
    if (!status.can_invite) {
        throw new ApiError(
            403,
            `Active employee login limit reached (${status.used}/${status.limit}). Upgrade your subscription plan to invite more users.`,
            {
                code: 'SEAT_LIMIT_REACHED',
                seat_status: status,
            }
        );
    }
    return status;
};

module.exports = {
    STUDIO_LOGIN_ROLES,
    getSeatLimitForPlan,
    countActiveStudioLogins,
    getStudioSeatStatus,
    assertCanInviteStudioLogin,
};

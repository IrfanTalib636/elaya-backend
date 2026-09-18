const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/userModel');
const Studio = require('../models/studioModel');
const { USER_ROLES, USER_STATUS } = require('../config/constants');
const {
    STUDIO_ACCOUNT_ROLES,
    STUDIO_ACCOUNT_ROLE_LIST,
    STUDIO_ACCOUNT_ROLE_META,
    STUDIO_PERMISSIONS,
    resolveStudioAccountRole,
    studioUserHasPermission,
} = require('../config/studioAccountRoles');
const {
    getStudioSeatStatus,
    assertCanInviteStudioLogin,
    STUDIO_LOGIN_ROLES,
} = require('../utils/studioSeatService');
const {
    sendPasswordResetEmail,
    buildResetPasswordUrl,
} = require('../services/emailService');
const { createPasswordResetToken } = require('../utils/passwordReset');
const { isAdmin } = require('../utils/accessHelpers');

const formatStudioLoginUser = (doc) => {
    const u = doc?.toObject ? doc.toObject() : doc;
    return {
        id: String(u._id),
        email: u.email,
        name: u.name || '',
        role: u.role,
        studio_account_role: resolveStudioAccountRole(u),
        status: u.status,
        staff_profile_id: u.staff_profile_id || null,
        studio_id: u.studio_id ? String(u.studio_id) : null,
        last_login: u.last_login || null,
        invited_at: u.invited_at || null,
        created_at: u.createdAt || null,
    };
};

const resolveStudioId = (req) => {
    if (isAdmin(req.user.role) && req.query.studio_id) {
        return req.query.studio_id;
    }
    if (isAdmin(req.user.role) && req.body?.studio_id) {
        return req.body.studio_id;
    }
    if (!req.user.studio_id) {
        throw new ApiError(403, 'Studio account required');
    }
    return String(req.user.studio_id);
};

const assertTeamManage = (user) => {
    if (isAdmin(user.role)) return;
    if (!studioUserHasPermission(user, STUDIO_PERMISSIONS.MANAGE_TEAM_LOGINS)) {
        throw new ApiError(403, 'Only studio owners can manage employee logins');
    }
};

const getSeatStatusHandler = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const status = await getStudioSeatStatus(studioId);
    res.status(200).json({
        success: true,
        data: {
            seat_status: status,
            account_roles: STUDIO_ACCOUNT_ROLE_META,
        },
    });
});

const listStudioLogins = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    if (!isAdmin(req.user.role) && String(req.user.studio_id) !== String(studioId)) {
        throw new ApiError(403, 'Not allowed');
    }
    const users = await User.find({
        studio_id: studioId,
        role: { $in: STUDIO_LOGIN_ROLES },
    })
        .sort({ createdAt: 1 })
        .select('-password -push_tokens');

    const seat_status = await getStudioSeatStatus(studioId);
    res.status(200).json({
        success: true,
        data: {
            users: users.map(formatStudioLoginUser),
            seat_status,
            account_roles: STUDIO_ACCOUNT_ROLE_META,
        },
    });
});

const inviteStudioLogin = asyncHandler(async (req, res) => {
    assertTeamManage(req.user);
    const studioId = resolveStudioId(req);
    if (!isAdmin(req.user.role) && String(req.user.studio_id) !== String(studioId)) {
        throw new ApiError(403, 'Not allowed');
    }

    const seat_status = await assertCanInviteStudioLogin(studioId);

    const email = String(req.body.email || '')
        .trim()
        .toLowerCase();
    const name = String(req.body.name || '').trim();
    let accountRole = req.body.studio_account_role || STUDIO_ACCOUNT_ROLES.TREATMENT;
    if (!STUDIO_ACCOUNT_ROLE_LIST.includes(accountRole)) {
        throw new ApiError(400, 'Invalid studio_account_role');
    }
    if (accountRole === STUDIO_ACCOUNT_ROLES.OWNER && !isAdmin(req.user.role)) {
        // Only platform admin can invite another owner; studio owner invites staff roles.
        const actorRole = resolveStudioAccountRole(req.user);
        if (actorRole !== STUDIO_ACCOUNT_ROLES.OWNER) {
            throw new ApiError(403, 'Cannot invite another studio owner');
        }
    }

    const staffProfileId = req.body.staff_profile_id
        ? String(req.body.staff_profile_id).trim()
        : null;
    if (staffProfileId) {
        const studio = await Studio.findById(studioId).select('mitarbeiter').lean();
        const found = (studio?.mitarbeiter || []).some(
            (m) => String(m._id) === staffProfileId
        );
        if (!found) throw new ApiError(400, 'staff_profile_id does not match a staff profile');
    }

    const existing = await User.findOne({ email });
    if (existing) throw new ApiError(409, 'A user with this email already exists');

    const loginRole =
        accountRole === STUDIO_ACCOUNT_ROLES.OWNER
            ? USER_ROLES.STUDIO_ADMIN
            : USER_ROLES.STUDIO_STAFF;

    const tempPassword = crypto.randomBytes(18).toString('base64url');
    const user = await User.create({
        email,
        name,
        password: tempPassword,
        role: loginRole,
        studio_account_role: accountRole,
        status: USER_STATUS.AKTIV,
        studio_id: studioId,
        staff_profile_id: staffProfileId,
        invited_by: req.user._id,
        invited_at: new Date(),
    });

    if (staffProfileId) {
        await Studio.updateOne(
            { _id: studioId, 'mitarbeiter._id': staffProfileId },
            { $set: { 'mitarbeiter.$.user_id': user._id } }
        );
    }

    const rawToken = await createPasswordResetToken(user._id);
    const inviteUrl = buildResetPasswordUrl('studio', rawToken);
    let invite_sent = false;
    try {
        await sendPasswordResetEmail({ to: email, resetUrl: inviteUrl });
        invite_sent = true;
    } catch (err) {
        console.error('Studio invite email failed:', err.message);
    }

    res.status(201).json({
        success: true,
        message: 'Employee login invited',
        data: {
            user: formatStudioLoginUser(user),
            seat_status: await getStudioSeatStatus(studioId),
            invite_sent,
            temporary_password:
                process.env.NODE_ENV === 'production' ? undefined : tempPassword,
            previous_seat_status: seat_status,
        },
    });
});

const patchStudioLogin = asyncHandler(async (req, res) => {
    assertTeamManage(req.user);
    const studioId = resolveStudioId(req);
    const user = await User.findById(req.params.id);
    if (!user || !STUDIO_LOGIN_ROLES.includes(user.role)) {
        throw new ApiError(404, 'Studio login not found');
    }
    if (!isAdmin(req.user.role) && String(user.studio_id) !== String(studioId)) {
        throw new ApiError(403, 'Not allowed');
    }
    if (String(user._id) === String(req.user._id) && req.body.status === USER_STATUS.GESPERRT) {
        throw new ApiError(400, 'Cannot deactivate your own account');
    }

    // Reactivating must respect seat limit
    if (
        req.body.status === USER_STATUS.AKTIV &&
        user.status !== USER_STATUS.AKTIV
    ) {
        await assertCanInviteStudioLogin(user.studio_id);
    }

    if (req.body.name !== undefined) user.name = String(req.body.name).trim();
    if (req.body.status !== undefined) {
        if (
            ![USER_STATUS.AKTIV, USER_STATUS.GESPERRT, USER_STATUS.AUSSTEHEND].includes(
                req.body.status
            )
        ) {
            throw new ApiError(400, 'Invalid status');
        }
        user.status = req.body.status;
    }
    if (req.body.studio_account_role !== undefined) {
        const role = req.body.studio_account_role;
        if (!STUDIO_ACCOUNT_ROLE_LIST.includes(role)) {
            throw new ApiError(400, 'Invalid studio_account_role');
        }
        user.studio_account_role = role;
        user.role =
            role === STUDIO_ACCOUNT_ROLES.OWNER
                ? USER_ROLES.STUDIO_ADMIN
                : USER_ROLES.STUDIO_STAFF;
    }
    if (req.body.staff_profile_id !== undefined) {
        const staffProfileId = req.body.staff_profile_id
            ? String(req.body.staff_profile_id).trim()
            : null;
        if (staffProfileId) {
            const studio = await Studio.findById(user.studio_id).select('mitarbeiter');
            const found = (studio?.mitarbeiter || []).find(
                (m) => String(m._id) === staffProfileId
            );
            if (!found) throw new ApiError(400, 'staff_profile_id does not match a staff profile');
            // clear previous links then set
            for (const m of studio.mitarbeiter) {
                if (m.user_id && String(m.user_id) === String(user._id)) {
                    m.user_id = null;
                }
            }
            found.user_id = user._id;
            await studio.save();
        }
        user.staff_profile_id = staffProfileId;
    }

    await user.save();

    res.status(200).json({
        success: true,
        message: 'Employee login updated',
        data: {
            user: formatStudioLoginUser(user),
            seat_status: await getStudioSeatStatus(user.studio_id),
        },
    });
});

/** Super Admin: all studio logins across studios. */
const listAllStudioLoginsAdmin = asyncHandler(async (req, res) => {
    const filter = { role: { $in: STUDIO_LOGIN_ROLES } };
    if (req.query.studio_id) filter.studio_id = req.query.studio_id;
    if (req.query.status) filter.status = req.query.status;

    const users = await User.find(filter)
        .sort({ createdAt: -1 })
        .limit(500)
        .select('-password -push_tokens')
        .populate('studio_id', 'firma studio_code subscription_plan');

    res.status(200).json({
        success: true,
        data: {
            users: users.map((u) => ({
                ...formatStudioLoginUser(u),
                studio: u.studio_id
                    ? {
                          id: String(u.studio_id._id),
                          firma: u.studio_id.firma,
                          studio_code: u.studio_id.studio_code,
                          subscription_plan: u.studio_id.subscription_plan,
                      }
                    : null,
            })),
            account_roles: STUDIO_ACCOUNT_ROLE_META,
        },
    });
});

/** Super Admin: staff profiles across studios (from Studio.mitarbeiter). */
const listAllStaffProfilesAdmin = asyncHandler(async (req, res) => {
    const filter = {};
    if (req.query.studio_id) filter._id = req.query.studio_id;
    const studios = await Studio.find(filter)
        .select('firma studio_code mitarbeiter')
        .limit(200)
        .lean();

    const profiles = [];
    for (const s of studios) {
        for (const m of s.mitarbeiter || []) {
            profiles.push({
                id: String(m._id),
                vorname: m.vorname,
                nachname: m.nachname,
                rolle: m.rolle,
                aktiv: m.aktiv !== false,
                user_id: m.user_id ? String(m.user_id) : null,
                studio: {
                    id: String(s._id),
                    firma: s.firma,
                    studio_code: s.studio_code,
                },
            });
        }
    }

    res.status(200).json({ success: true, data: { profiles } });
});

module.exports = {
    getSeatStatusHandler,
    listStudioLogins,
    inviteStudioLogin,
    patchStudioLogin,
    listAllStudioLoginsAdmin,
    listAllStaffProfilesAdmin,
};

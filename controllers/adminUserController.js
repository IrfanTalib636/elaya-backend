const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/userModel');
const { USER_ROLES, USER_STATUS } = require('../config/constants');
const {
    ADMIN_PERMISSION_LIST,
    ADMIN_PERMISSION_META,
    ADMIN_PERMISSIONS,
} = require('../config/adminPermissions');
const { hasPermission, isSuperAdminLike } = require('../middleware/authMiddleware');
const {
    sendPasswordResetEmail,
    buildResetPasswordUrl,
} = require('../services/emailService');
const { createPasswordResetToken } = require('../utils/passwordReset');

const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

const formatAdminUser = (doc) => {
    const u = doc?.toObject ? doc.toObject() : doc;
    return {
        id: String(u._id),
        email: u.email,
        name: u.name || '',
        role: u.role,
        status: u.status,
        permissions: Array.isArray(u.permissions) ? u.permissions : [],
        last_login: u.last_login || null,
        invited_at: u.invited_at || null,
        created_at: u.createdAt || null,
        updated_at: u.updatedAt || null,
    };
};

const assertCanManageAdmins = (actor) => {
    if (!hasPermission(actor, ADMIN_PERMISSIONS.MANAGE_ADMINS)) {
        throw new ApiError(403, 'Missing manage_admins permission');
    }
};

const listAdminUsers = asyncHandler(async (req, res) => {
    assertCanManageAdmins(req.user);
    const users = await User.find({ role: { $in: ADMIN_ROLES } })
        .sort({ createdAt: -1 })
        .select('-password -push_tokens');
    res.status(200).json({
        success: true,
        data: {
            users: users.map(formatAdminUser),
            permission_catalog: ADMIN_PERMISSION_META,
        },
    });
});

const inviteAdminUser = asyncHandler(async (req, res) => {
    assertCanManageAdmins(req.user);

    const email = String(req.body.email || '')
        .trim()
        .toLowerCase();
    const name = String(req.body.name || '').trim();
    const role = req.body.role || USER_ROLES.ADMIN;
    const permissions = Array.isArray(req.body.permissions)
        ? req.body.permissions.filter((p) => ADMIN_PERMISSION_LIST.includes(p))
        : [];

    if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(role)) {
        throw new ApiError(400, 'Can only invite admin or super_admin');
    }
    if (role === USER_ROLES.SUPER_ADMIN && !isSuperAdminLike(req.user)) {
        throw new ApiError(403, 'Only super admin can invite another super admin');
    }

    const existing = await User.findOne({ email });
    if (existing) {
        throw new ApiError(409, 'A user with this email already exists');
    }

    const tempPassword = crypto.randomBytes(18).toString('base64url');
    const user = await User.create({
        email,
        name,
        password: tempPassword,
        role,
        status: USER_STATUS.AKTIV,
        permissions: role === USER_ROLES.ADMIN ? permissions : [],
        invited_by: req.user._id,
        invited_at: new Date(),
    });

    const rawToken = await createPasswordResetToken(user._id);
    const inviteUrl = buildResetPasswordUrl('admin', rawToken);
    let inviteSent = false;
    try {
        await sendPasswordResetEmail({ to: email, resetUrl: inviteUrl });
        inviteSent = true;
    } catch (err) {
        console.error('Admin invite email failed:', err.message);
    }

    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.ADMIN_INVITE,
        targetType: 'user',
        targetId: String(user._id),
        after: formatAdminUser(user),
        meta: { email, role },
        ip: req.ip,
    });

    res.status(201).json({
        success: true,
        message: 'Admin invited',
        data: {
            user: formatAdminUser(user),
            invite_sent: inviteSent,
            // Dev convenience only — never in production responses.
            temporary_password:
                process.env.NODE_ENV === 'production' ? undefined : tempPassword,
        },
    });
});

const patchAdminUser = asyncHandler(async (req, res) => {
    assertCanManageAdmins(req.user);
    const user = await User.findById(req.params.id);
    if (!user || !ADMIN_ROLES.includes(user.role)) {
        throw new ApiError(404, 'Admin user not found');
    }
    if (user.role === USER_ROLES.DEVELOPER && !isSuperAdminLike(req.user)) {
        throw new ApiError(403, 'Cannot modify developer accounts');
    }
    if (String(user._id) === String(req.user._id) && req.body.status === USER_STATUS.GESPERRT) {
        throw new ApiError(400, 'Cannot deactivate your own account');
    }

    const before = formatAdminUser(user);

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
    if (req.body.role !== undefined) {
        if (![USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN].includes(req.body.role)) {
            throw new ApiError(400, 'Invalid role');
        }
        if (req.body.role === USER_ROLES.SUPER_ADMIN && !isSuperAdminLike(req.user)) {
            throw new ApiError(403, 'Only super admin can promote to super_admin');
        }
        user.role = req.body.role;
        if (user.role !== USER_ROLES.ADMIN) user.permissions = [];
    }
    if (req.body.permissions !== undefined) {
        if (user.role !== USER_ROLES.ADMIN) {
            throw new ApiError(400, 'Permissions only apply to role=admin');
        }
        user.permissions = (req.body.permissions || []).filter((p) =>
            ADMIN_PERMISSION_LIST.includes(p)
        );
    }

    await user.save();

    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.ADMIN_UPDATE,
        targetType: 'user',
        targetId: String(user._id),
        before,
        after: formatAdminUser(user),
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: 'Admin updated',
        data: { user: formatAdminUser(user) },
    });
});

const getPermissionCatalog = asyncHandler(async (_req, res) => {
    res.status(200).json({
        success: true,
        data: { permissions: ADMIN_PERMISSION_META },
    });
});

module.exports = {
    listAdminUsers,
    inviteAdminUser,
    patchAdminUser,
    getPermissionCatalog,
};

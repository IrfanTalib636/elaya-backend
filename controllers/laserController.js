const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const LaserRequest = require('../models/laserRequestModel');
const {
    listLaserDevices,
    createLaserDevice,
    updateLaserDevice,
    getLaserDeviceById,
    getDefaultLaserColors,
    saveLaserColorDraft,
} = require('../utils/laserCatalogService');
const { ADMIN_PERMISSIONS } = require('../config/adminPermissions');
const { USER_ROLES } = require('../config/constants');
const { hasPermission } = require('../middleware/authMiddleware');

/** Colour deltas drive the session prediction, so they share the Engine's super-admin draft rule. */
const assertCanDraftColors = (user, colorDeltas) => {
    if (colorDeltas === undefined) return;
    if (user?.role !== USER_ROLES.SUPER_ADMIN) {
        throw new ApiError(403, 'Only super admin can change laser colour deltas (draft → publish)');
    }
};

const draftLaserColors = async (req, device, colorDeltas) => {
    if (colorDeltas === undefined) return false;
    const changed = await saveLaserColorDraft(device.id, colorDeltas, {
        userId: req.user._id || req.user.id,
        label: device.label,
    });
    if (changed) {
        const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
        void logPlatformAudit({
            actor: req.user,
            action: PLATFORM_AUDIT_ACTION.CONFIG_DRAFT_SAVE,
            targetType: 'platform',
            targetId: 'config_draft:session_prediction',
            reason: `Laser colour deltas: ${device.label}`,
            before: device.color_deltas_draft || device.color_deltas,
            after: colorDeltas,
            meta: { domain: 'session_prediction', laser_device_id: device.id },
            ip: req.ip,
        });
    }
    return changed;
};

const listLasers = asyncHandler(async (req, res) => {
    const activeOnly = String(req.query.active_only || '') === 'true';
    // Studios only see active devices
    const isStudio =
        req.user?.role === 'studio_admin' || req.user?.role === 'studio_staff';
    const devices = await listLaserDevices({
        activeOnly: isStudio ? true : activeOnly,
    });
    const default_color_deltas = isStudio ? undefined : await getDefaultLaserColors();
    res.status(200).json({ success: true, data: { devices, default_color_deltas } });
});

const getLaser = asyncHandler(async (req, res) => {
    const device = await getLaserDeviceById(req.params.id);
    res.status(200).json({ success: true, data: { device } });
});

const createLaser = asyncHandler(async (req, res) => {
    if (!hasPermission(req.user, ADMIN_PERMISSIONS.MANAGE_LASER_CATALOG)) {
        throw new ApiError(403, 'Missing manage_laser_catalog permission');
    }
    const { color_deltas: colorDeltas, ...master } = req.body;
    assertCanDraftColors(req.user, colorDeltas);
    let device = await createLaserDevice(master, req.user._id || req.user.id);
    const colorsDrafted = await draftLaserColors(req, device, colorDeltas);
    if (colorsDrafted) device = await getLaserDeviceById(device.id);
    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.LASER_CATALOG_CREATE,
        targetType: 'laser',
        targetId: device.id,
        after: device,
        ip: req.ip,
    });
    res.status(201).json({
        success: true,
        message: colorsDrafted
            ? 'Laser device created · colour deltas saved as draft'
            : 'Laser device created',
        data: { device, colors_drafted: colorsDrafted },
    });
});

const patchLaser = asyncHandler(async (req, res) => {
    if (!hasPermission(req.user, ADMIN_PERMISSIONS.MANAGE_LASER_CATALOG)) {
        throw new ApiError(403, 'Missing manage_laser_catalog permission');
    }
    const { color_deltas: colorDeltas, ...master } = req.body;
    assertCanDraftColors(req.user, colorDeltas);
    const before = await getLaserDeviceById(req.params.id);
    let device = await updateLaserDevice(req.params.id, master, req.user._id || req.user.id);
    const colorsDrafted = await draftLaserColors(req, device, colorDeltas);
    if (colorsDrafted) device = await getLaserDeviceById(device.id);
    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.LASER_CATALOG_UPDATE,
        targetType: 'laser',
        targetId: device.id,
        before,
        after: device,
        ip: req.ip,
    });
    res.status(200).json({
        success: true,
        message: colorsDrafted
            ? 'Laser device updated · colour deltas saved as draft'
            : 'Laser device updated',
        data: { device, colors_drafted: colorsDrafted },
    });
});

const requestLaser = asyncHandler(async (req, res) => {
    if (!req.user.studio_id) {
        throw new ApiError(403, 'Studio account required');
    }
    const row = await LaserRequest.create({
        studio: req.user.studio_id,
        requested_by: req.user._id,
        manufacturer: String(req.body.manufacturer || '').trim(),
        model: String(req.body.model || '').trim(),
        wavelengths_nm: req.body.wavelengths_nm || [],
        notes: req.body.notes || '',
        status: 'pending',
    });
    res.status(201).json({
        success: true,
        message: 'Laser request submitted',
        data: {
            request: {
                id: String(row._id),
                manufacturer: row.manufacturer,
                model: row.model,
                status: row.status,
            },
        },
    });
});

const listLaserRequests = asyncHandler(async (req, res) => {
    if (!hasPermission(req.user, ADMIN_PERMISSIONS.MANAGE_LASER_CATALOG)) {
        throw new ApiError(403, 'Missing manage_laser_catalog permission');
    }
    const status = req.query.status || 'pending';
    const filter = status === 'all' ? {} : { status };
    const rows = await LaserRequest.find(filter)
        .sort({ createdAt: -1 })
        .limit(100)
        .populate('studio', 'firma studio_code')
        .populate('requested_by', 'email')
        .lean();
    res.status(200).json({
        success: true,
        data: {
            requests: rows.map((r) => ({
                id: String(r._id),
                manufacturer: r.manufacturer,
                model: r.model,
                wavelengths_nm: r.wavelengths_nm || [],
                notes: r.notes || '',
                status: r.status,
                admin_note: r.admin_note || '',
                studio: r.studio
                    ? {
                          id: String(r.studio._id),
                          firma: r.studio.firma,
                          studio_code: r.studio.studio_code,
                      }
                    : null,
                requested_by: r.requested_by?.email || null,
                created_at: r.createdAt,
            })),
        },
    });
});

const resolveLaserRequest = asyncHandler(async (req, res) => {
    if (!hasPermission(req.user, ADMIN_PERMISSIONS.MANAGE_LASER_CATALOG)) {
        throw new ApiError(403, 'Missing manage_laser_catalog permission');
    }
    const decision = req.body.decision;
    if (!['approved', 'rejected'].includes(decision)) {
        throw new ApiError(400, 'decision must be approved or rejected');
    }
    const row = await LaserRequest.findById(req.params.id);
    if (!row) throw new ApiError(404, 'Laser request not found');
    if (row.status !== 'pending') {
        throw new ApiError(400, 'Request already resolved');
    }

    row.status = decision;
    row.admin_note = req.body.admin_note || '';
    row.resolved_by = req.user._id;
    row.resolved_at = new Date();

    let device = null;
    if (decision === 'approved') {
        device = await createLaserDevice(
            {
                manufacturer: row.manufacturer,
                model: row.model,
                wavelengths_nm: row.wavelengths_nm,
                notes: row.notes,
                active: true,
            },
            req.user._id
        );
        row.laser_device = device.id;
    }
    await row.save();

    const { logPlatformAudit, PLATFORM_AUDIT_ACTION } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.LASER_REQUEST_RESOLVE,
        targetType: 'laser',
        targetId: String(row._id),
        studioId: row.studio,
        reason: row.admin_note,
        after: { status: decision, laser_device: device },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: `Request ${decision}`,
        data: { request_id: String(row._id), status: decision, device },
    });
});

module.exports = {
    listLasers,
    getLaser,
    createLaser,
    patchLaser,
    requestLaser,
    listLaserRequests,
    resolveLaserRequest,
};

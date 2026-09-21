const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Studio = require('../models/studioModel');
const User = require('../models/userModel');
const { USER_ROLES, USER_STATUS, STUDIO_STATUS } = require('../config/constants');
const { isAdmin, isStudio } = require('../utils/accessHelpers');
const { mergeOeffnungszeiten } = require('../config/studioDefaults');
const { normalizeAusnahmen, buildStudioScheduleSnapshot } = require('../utils/studioHours');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { emitStudioScheduleUpdated } = require('../sockets/studioScheduleEmit');

const PROFILE_FIELDS = ['firma', 'telefon', 'strasse', 'plz', 'ort', 'land', 'notizen'];

const formatStandort = (doc) => {
    const s = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(s._id),
        name: s.name,
        strasse: s.strasse ?? '',
        plz: s.plz ?? '',
        ort: s.ort ?? '',
        land: s.land ?? 'Schweiz',
        aktiv: s.aktiv !== false,
        oeffnungszeiten: s.oeffnungszeiten ?? null,
        oeffnungs_ausnahmen: normalizeAusnahmen(s.oeffnungs_ausnahmen),
        pufferzeit_minuten: s.pufferzeit_minuten ?? null,
        slot_interval_minuten: s.slot_interval_minuten ?? null,
    };
};

const formatRaum = (doc) => {
    const r = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(r._id),
        name: r.name,
        farbe: r.farbe ?? '#3B8BD4',
        aktiv: r.aktiv !== false,
        laser_brand: r.laser_brand ?? '',
        laser_model: r.laser_model ?? '',
        laser_device_id: r.laser_device_id ? String(r.laser_device_id) : null,
        standort_id: r.standort_id ?? '',
    };
};

const formatMitarbeiter = (doc) => {
    const m = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(m._id),
        vorname: m.vorname,
        nachname: m.nachname,
        rolle: m.rolle ?? 'Laser-Therapeutin',
        raum_id: m.raum_id ?? '',
        standort_id: m.standort_id ?? '',
        aktiv: m.aktiv !== false,
        user_id: m.user_id ?? null,
    };
};

const formatStudioSettings = (studio) => {
    const doc = studio.toObject ? studio.toObject() : studio;

    return {
        studio_id: doc._id,
        profile: {
            firma: doc.firma,
            email: doc.email,
            telefon: doc.telefon ?? '',
            strasse: doc.strasse ?? '',
            plz: doc.plz ?? '',
            ort: doc.ort ?? '',
            land: doc.land ?? 'Schweiz',
            studio_code: doc.studio_code,
            status: doc.status,
            notizen: doc.notizen ?? '',
        },
        oeffnungszeiten: mergeOeffnungszeiten(doc.oeffnungszeiten),
        oeffnungs_ausnahmen: normalizeAusnahmen(doc.oeffnungs_ausnahmen),
        standorte: (doc.standorte ?? []).map(formatStandort),
        behandlungsraeume: (doc.behandlungsraeume ?? []).map(formatRaum),
        mitarbeiter: (doc.mitarbeiter ?? []).map(formatMitarbeiter),
        pufferzeit_minuten: doc.pufferzeit_minuten ?? 10,
        slot_interval_minuten: doc.slot_interval_minuten ?? 60,
        stripe: {
            account_id: doc.stripe_account_id || null,
            onboarding_complete: Boolean(doc.stripe_onboarding_complete),
            charges_enabled: Boolean(doc.stripe_charges_enabled),
            payouts_enabled: Boolean(doc.stripe_payouts_enabled),
        },
    };
};

const resolveStudioForUser = async (user, studioIdParam) => {
    if (studioIdParam) {
        if (!isAdmin(user.role)) {
            throw new ApiError(403, 'Only admins can access settings for other studios');
        }
        if (
            !mongoose.Types.ObjectId.isValid(studioIdParam) ||
            String(new mongoose.Types.ObjectId(studioIdParam)) !== String(studioIdParam)
        ) {
            throw new ApiError(400, 'Invalid studioId');
        }
        const studio = await Studio.findById(studioIdParam);
        if (!studio) {
            throw new ApiError(404, 'Studio not found');
        }
        return studio;
    }

    if (!isStudio(user.role) || !user.studio_id) {
        throw new ApiError(403, 'Studio account required');
    }

    const studio = await Studio.findById(user.studio_id);
    if (!studio) {
        throw new ApiError(404, 'Studio not found');
    }
    return studio;
};

const applyProfilePatch = (studio, profile = {}) => {
    for (const key of PROFILE_FIELDS) {
        if (profile[key] !== undefined) {
            studio[key] = profile[key];
        }
    }
};

const applyOeffnungszeitenPatch = (studio, patch = {}) => {
    const current = mergeOeffnungszeiten(studio.oeffnungszeiten);
    for (const [day, hours] of Object.entries(patch)) {
        current[day] = { ...current[day], ...hours };
    }
    studio.oeffnungszeiten = current;
    studio.markModified('oeffnungszeiten');
};

const mapStandorteInput = (standorte = []) =>
    standorte.map((s) => ({
        ...(s.id && mongoose.Types.ObjectId.isValid(s.id) ? { _id: s.id } : {}),
        name: s.name,
        strasse: s.strasse ?? '',
        plz: s.plz ?? '',
        ort: s.ort ?? '',
        land: s.land ?? 'Schweiz',
        aktiv: s.aktiv !== false,
        oeffnungszeiten: s.oeffnungszeiten ?? null,
        oeffnungs_ausnahmen: normalizeAusnahmen(s.oeffnungs_ausnahmen ?? []),
        pufferzeit_minuten: s.pufferzeit_minuten ?? null,
        slot_interval_minuten: s.slot_interval_minuten ?? null,
    }));

const mapRoomsInput = async (rooms = []) => {
    const { assertActiveLaserDeviceId } = require('../utils/laserCatalogService');
    const mapped = [];
    for (const r of rooms) {
        let laserBrand = r.laser_brand ?? '';
        let laserModel = r.laser_model ?? '';
        let laserDeviceId = r.laser_device_id || null;
        if (laserDeviceId) {
            const device = await assertActiveLaserDeviceId(laserDeviceId);
            laserBrand = device.manufacturer;
            laserModel = device.model;
            laserDeviceId = device.id;
        }
        mapped.push({
            ...(r.id && mongoose.Types.ObjectId.isValid(r.id) ? { _id: r.id } : {}),
            name: r.name,
            farbe: r.farbe ?? '#3B8BD4',
            aktiv: r.aktiv !== false,
            laser_brand: laserBrand,
            laser_model: laserModel,
            laser_device_id: laserDeviceId,
            standort_id: r.standort_id ?? '',
        });
    }
    return mapped;
};

const mapStaffInput = (staff = []) =>
    staff.map((m) => ({
        ...(m.id && mongoose.Types.ObjectId.isValid(m.id) ? { _id: m.id } : {}),
        vorname: m.vorname,
        nachname: m.nachname,
        rolle: m.rolle ?? 'Laser-Therapeutin',
        raum_id: m.raum_id ?? '',
        standort_id: m.standort_id ?? '',
        aktiv: m.aktiv !== false,
        // Preserve optional link to a User Account when the client sends it.
        ...(m.user_id && mongoose.Types.ObjectId.isValid(m.user_id)
            ? { user_id: m.user_id }
            : m.user_id === null
              ? { user_id: null }
              : {}),
    }));

const validateStaffRoomRefs = (rooms, staff) => {
    const roomIds = new Set(rooms.map((r) => String(r._id ?? r.id)));
    for (const member of staff) {
        const raumId = member.raum_id?.trim();
        if (raumId && !roomIds.has(raumId)) {
            throw new ApiError(400, `mitarbeiter references unknown raum_id: ${raumId}`);
        }
    }
};

/** Rooms and staff may only point at locations that exist on this studio. */
const validateStandortRefs = (standorte, rooms = [], staff = []) => {
    const ids = new Set(standorte.map((s) => String(s._id ?? s.id)));
    for (const room of rooms) {
        const id = room.standort_id?.trim();
        if (id && !ids.has(id)) {
            throw new ApiError(400, `behandlungsraeume references unknown standort_id: ${id}`);
        }
    }
    for (const member of staff) {
        const id = member.standort_id?.trim();
        if (id && !ids.has(id)) {
            throw new ApiError(400, `mitarbeiter references unknown standort_id: ${id}`);
        }
    }
};

const getStudioSettings = asyncHandler(async (req, res) => {
    const studio = await resolveStudioForUser(req.user, req.params.studioId);

    res.status(200).json({
        success: true,
        data: { settings: formatStudioSettings(studio) },
    });
});

const patchStudioSettings = asyncHandler(async (req, res) => {
    const studio = await resolveStudioForUser(req.user, req.params.studioId);

    if (!isAdmin(req.user.role) && req.user.role !== USER_ROLES.STUDIO_ADMIN) {
        throw new ApiError(403, 'Only studio admins can update studio settings');
    }

    const {
        profile,
        oeffnungszeiten,
        oeffnungs_ausnahmen,
        standorte,
        behandlungsraeume,
        mitarbeiter,
        pufferzeit_minuten,
        slot_interval_minuten,
    } = req.body;

    if (profile) {
        applyProfilePatch(studio, profile);
    }

    if (oeffnungszeiten) {
        applyOeffnungszeitenPatch(studio, oeffnungszeiten);
    }

    if (oeffnungs_ausnahmen !== undefined) {
        studio.oeffnungs_ausnahmen = normalizeAusnahmen(oeffnungs_ausnahmen);
        studio.markModified('oeffnungs_ausnahmen');
    }

    if (standorte !== undefined) {
        studio.standorte = mapStandorteInput(standorte);
        studio.markModified('standorte');
    }

    if (behandlungsraeume !== undefined) {
        studio.behandlungsraeume = await mapRoomsInput(behandlungsraeume);
    }

    if (mitarbeiter !== undefined) {
        const rooms = behandlungsraeume !== undefined
            ? studio.behandlungsraeume
            : studio.behandlungsraeume ?? [];
        const staff = mapStaffInput(mitarbeiter);
        validateStaffRoomRefs(
            rooms.map((r) => ({ id: String(r._id) })),
            staff
        );
        studio.mitarbeiter = staff;
    }

    validateStandortRefs(
        (studio.standorte ?? []).map((s) => ({ id: String(s._id) })),
        studio.behandlungsraeume ?? [],
        studio.mitarbeiter ?? []
    );

    if (pufferzeit_minuten !== undefined) {
        studio.pufferzeit_minuten = pufferzeit_minuten;
    }

    if (slot_interval_minuten !== undefined) {
        studio.slot_interval_minuten = slot_interval_minuten;
    }

    const scheduleTouched =
        oeffnungszeiten !== undefined ||
        oeffnungs_ausnahmen !== undefined ||
        pufferzeit_minuten !== undefined ||
        slot_interval_minuten !== undefined;

    await studio.save();

    if (scheduleTouched) {
        emitStudioScheduleUpdated(studio._id, {
            schedule: buildStudioScheduleSnapshot(studio),
        });
    }

    res.status(200).json({
        success: true,
        message: 'Studio settings updated',
        data: { settings: formatStudioSettings(studio) },
    });
});

const formatStudioAdminRow = (studio, ownerUser) => ({
    id: studio._id,
    firma: studio.firma,
    studio_code: studio.studio_code,
    email: studio.email,
    telefon: studio.telefon ?? '',
    ort: studio.ort ?? '',
    status: studio.status,
    owner: ownerUser
        ? {
              id: ownerUser._id,
              email: ownerUser.email,
              status: ownerUser.status,
          }
        : null,
    createdAt: studio.createdAt,
});

const userStatusForStudioStatus = (studioStatus) => {
    if (studioStatus === STUDIO_STATUS.AKTIV) {
        return USER_STATUS.AKTIV;
    }
    if (studioStatus === STUDIO_STATUS.GESPERRT) {
        return USER_STATUS.GESPERRT;
    }
    return USER_STATUS.AUSSTEHEND;
};

const listStudiosAdmin = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { status, search } = req.query;

    const filter = {};
    if (status) {
        filter.status = status;
    }
    if (search) {
        const re = new RegExp(search, 'i');
        filter.$or = [{ firma: re }, { studio_code: re }, { email: re }, { ort: re }];
    }

    const [studios, total] = await Promise.all([
        Studio.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        Studio.countDocuments(filter),
    ]);

    const ownerIds = studios.map((s) => s.owner).filter(Boolean);
    const owners = await User.find({ _id: { $in: ownerIds } })
        .select('email status')
        .lean();
    const ownerMap = Object.fromEntries(owners.map((u) => [String(u._id), u]));

    res.status(200).json({
        success: true,
        data: {
            studios: studios.map((s) =>
                formatStudioAdminRow(s, ownerMap[String(s.owner)] ?? null)
            ),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const formatPublicStandort = (standort) => {
    const doc = standort.toObject ? standort.toObject() : standort;
    return {
        id: doc._id ? String(doc._id) : '',
        name: doc.name,
        strasse: doc.strasse ?? '',
        plz: doc.plz ?? '',
        ort: doc.ort ?? '',
        land: doc.land ?? 'Schweiz',
    };
};

const formatPublicStudio = (studio) => {
    const doc = studio.toObject ? studio.toObject() : studio;
    return {
        id: doc._id ? String(doc._id) : '',
        studio_code: doc.studio_code,
        firma: doc.firma,
        strasse: doc.strasse ?? '',
        plz: doc.plz ?? '',
        ort: doc.ort ?? '',
        land: doc.land ?? 'Schweiz',
        standorte: (doc.standorte ?? [])
            .filter((s) => s.aktiv !== false)
            .map(formatPublicStandort),
    };
};

/** Active studios for customer registration dropdown — no auth, no internal fields. */
const listPublicStudios = asyncHandler(async (req, res) => {
    const studios = await Studio.find({ status: STUDIO_STATUS.AKTIV })
        .select('studio_code firma strasse plz ort land standorte')
        .sort({ firma: 1 })
        .lean();

    res.status(200).json({
        success: true,
        data: {
            studios: studios.map(formatPublicStudio),
        },
    });
});

const patchStudioStatus = asyncHandler(async (req, res) => {
    const { studioId } = req.params;
    const { status, notizen } = req.body;

    if (
        !mongoose.Types.ObjectId.isValid(studioId) ||
        String(new mongoose.Types.ObjectId(studioId)) !== String(studioId)
    ) {
        throw new ApiError(400, 'Invalid studioId');
    }

    const studio = await Studio.findById(studioId);
    if (!studio) {
        throw new ApiError(404, 'Studio not found');
    }

    studio.status = status;
    if (notizen !== undefined) {
        studio.notizen = notizen;
    }
    await studio.save();

    const ownerStatus = userStatusForStudioStatus(status);

    if (studio.owner) {
        await User.findByIdAndUpdate(studio.owner, { status: ownerStatus });
    }

    await User.updateMany(
        { studio_id: studio._id, role: { $in: [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF] } },
        { status: ownerStatus }
    );

    const owner = studio.owner
        ? await User.findById(studio.owner).select('email status').lean()
        : null;

    res.status(200).json({
        success: true,
        message: 'Studio status updated',
        data: {
            studio: formatStudioAdminRow(studio.toObject(), owner),
        },
    });
});

/**
 * POST /studio/admin/studios/:studioId/workspace/open
 * Super-admin / admin opens a support workspace for a studio (no impersonation).
 * Records an audit row and returns studio summary for the UI shell.
 */
const openStudioWorkspace = asyncHandler(async (req, res) => {
    if (!isAdmin(req.user.role)) {
        throw new ApiError(403, 'Only Elaya admins can open a studio workspace');
    }

    const studioId = req.params.studioId;
    if (!mongoose.Types.ObjectId.isValid(studioId)) {
        throw new ApiError(400, 'Invalid studio id');
    }

    const studio = await Studio.findById(studioId)
        .select('firma studio_code email status ort plz strasse land telefon')
        .lean();
    if (!studio) throw new ApiError(404, 'Studio not found');

    const Customer = require('../models/customerModel');
    const Case = require('../models/caseModel');
    const Appointment = require('../models/appointmentModel');

    const [customerCount, caseCount, upcomingAppointments] = await Promise.all([
        Customer.countDocuments({
            $or: [
                { aktuelle_firma_id: studio._id },
                { 'firma_history.firma_id': studio._id },
            ],
        }),
        Case.countDocuments({ studio: studio._id }),
        Appointment.countDocuments({
            studio: studio._id,
            date: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
            status: { $nin: ['storniert', 'cancelled'] },
        }),
    ]);

    const {
        logPlatformAudit,
        PLATFORM_AUDIT_ACTION,
    } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: req.user,
        action: PLATFORM_AUDIT_ACTION.STUDIO_WORKSPACE_OPEN,
        targetType: 'studio',
        targetId: String(studio._id),
        studioId: studio._id,
        reason: req.body?.reason || '',
        meta: {
            studio_code: studio.studio_code,
            firma: studio.firma,
        },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: 'Studio workspace opened',
        data: {
            studio: {
                id: String(studio._id),
                firma: studio.firma || '',
                studio_code: studio.studio_code || '',
                email: studio.email || '',
                status: studio.status,
                ort: studio.ort || '',
                plz: studio.plz || '',
                strasse: studio.strasse || '',
                land: studio.land || '',
                telefon: studio.telefon || '',
            },
            counts: {
                customers: customerCount,
                cases: caseCount,
                upcoming_appointments: upcomingAppointments,
            },
            acting_as: 'elaya_admin',
        },
    });
});

const WORKSPACE_TOKEN_TTL = process.env.JWT_WORKSPACE_EXPIRES_IN || '2h';

const issueActingStudioToken = ({ adminUser, studio, editMode = false, reason = '' }) => {
    const {
        generateAccessTokenWithExpiry,
    } = require('../utils/generateTokenAndSetCookies');
    return generateAccessTokenWithExpiry(
        {
            userId: String(adminUser._id || adminUser.id),
            actingAsStudio: true,
            actingStudioId: String(studio._id || studio.id),
            editMode: Boolean(editMode),
            reason: String(reason || '').slice(0, 500),
        },
        WORKSPACE_TOKEN_TTL
    );
};

const formatWorkspaceStudio = (studio) => ({
    id: String(studio._id),
    firma: studio.firma || '',
    studio_code: studio.studio_code || '',
    email: studio.email || '',
    status: studio.status,
    ort: studio.ort || '',
});

/**
 * POST /studio/admin/studios/:studioId/workspace/enter
 * Enter full studio dashboard as that studio (no studio login). Starts read-only.
 */
const enterStudioWorkspace = asyncHandler(async (req, res) => {
    // Route is authorize(admin) — but protect may already have rewritten role if re-entering.
    const actor = req.user._impersonation
        ? {
              _id: req.user._impersonation.admin_id,
              role: req.user._impersonation.admin_role,
              email: req.user._impersonation.admin_email,
          }
        : req.user;

    if (!isAdmin(actor.role)) {
        throw new ApiError(403, 'Only Elaya admins can enter a studio workspace');
    }

    const studioId = req.params.studioId;
    if (!mongoose.Types.ObjectId.isValid(studioId)) {
        throw new ApiError(400, 'Invalid studio id');
    }

    const studio = await Studio.findById(studioId)
        .select('firma studio_code email status ort')
        .lean();
    if (!studio) throw new ApiError(404, 'Studio not found');

    const accessToken = issueActingStudioToken({
        adminUser: actor,
        studio,
        editMode: false,
        reason: '',
    });

    const {
        logPlatformAudit,
        PLATFORM_AUDIT_ACTION,
    } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: { _id: actor._id, role: actor.role, email: actor.email },
        action: PLATFORM_AUDIT_ACTION.STUDIO_WORKSPACE_OPEN,
        targetType: 'studio',
        targetId: String(studio._id),
        studioId: studio._id,
        reason: '',
        meta: {
            mode: 'enter_studio_dashboard',
            edit_mode: false,
            studio_code: studio.studio_code,
            firma: studio.firma,
        },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: 'Entered studio workspace (read-only)',
        data: {
            accessToken,
            expiresIn: WORKSPACE_TOKEN_TTL,
            edit_mode: false,
            studio: formatWorkspaceStudio(studio),
        },
    });
});

/**
 * POST /studio/admin/studios/:studioId/workspace/edit-mode
 * Enable write access inside an active studio workspace (reason required, ≥10 chars).
 */
const enableStudioWorkspaceEdit = asyncHandler(async (req, res) => {
    const imp = req.user._impersonation;
    if (!imp?.active) {
        throw new ApiError(403, 'Active studio workspace session required');
    }

    const studioId = req.params.studioId;
    if (String(imp.studio_id) !== String(studioId)) {
        throw new ApiError(403, 'Workspace studio mismatch');
    }

    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 10) {
        throw new ApiError(400, 'Reason must be at least 10 characters');
    }

    const studio = await Studio.findById(studioId)
        .select('firma studio_code email status ort')
        .lean();
    if (!studio) throw new ApiError(404, 'Studio not found');

    const accessToken = issueActingStudioToken({
        adminUser: { _id: imp.admin_id },
        studio,
        editMode: true,
        reason,
    });

    const {
        logPlatformAudit,
        PLATFORM_AUDIT_ACTION,
    } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: { _id: imp.admin_id, role: imp.admin_role, email: imp.admin_email },
        action: PLATFORM_AUDIT_ACTION.STUDIO_WORKSPACE_OPEN,
        targetType: 'studio',
        targetId: String(studio._id),
        studioId: studio._id,
        reason,
        meta: {
            mode: 'enable_edit',
            edit_mode: true,
            studio_code: studio.studio_code,
            firma: studio.firma,
        },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: 'Edit mode enabled',
        data: {
            accessToken,
            expiresIn: WORKSPACE_TOKEN_TTL,
            edit_mode: true,
            reason,
            studio: formatWorkspaceStudio(studio),
        },
    });
});

/**
 * POST /studio/admin/studios/:studioId/workspace/exit
 * Audit exit; client restores the admin access token.
 */
const exitStudioWorkspace = asyncHandler(async (req, res) => {
    const imp = req.user._impersonation;
    if (!imp?.active) {
        return res.status(200).json({
            success: true,
            message: 'No active workspace',
            data: {},
        });
    }

    const {
        logPlatformAudit,
        PLATFORM_AUDIT_ACTION,
    } = require('../services/platformAuditService');
    void logPlatformAudit({
        actor: { _id: imp.admin_id, role: imp.admin_role, email: imp.admin_email },
        action: PLATFORM_AUDIT_ACTION.STUDIO_WORKSPACE_OPEN,
        targetType: 'studio',
        targetId: String(imp.studio_id),
        studioId: imp.studio_id,
        reason: imp.reason || '',
        meta: {
            mode: 'exit_studio_dashboard',
            edit_mode: imp.edit_mode,
            studio_code: imp.studio_code,
            firma: imp.studio_firma,
        },
        ip: req.ip,
    });

    res.status(200).json({
        success: true,
        message: 'Exited studio workspace',
        data: {},
    });
});

module.exports = {
    formatStudioSettings,
    formatPublicStudio,
    getStudioSettings,
    patchStudioSettings,
    listStudiosAdmin,
    listPublicStudios,
    patchStudioStatus,
    openStudioWorkspace,
    enterStudioWorkspace,
    enableStudioWorkspaceEdit,
    exitStudioWorkspace,
};

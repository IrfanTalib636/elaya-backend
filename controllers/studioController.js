const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Studio = require('../models/studioModel');
const User = require('../models/userModel');
const { USER_ROLES, USER_STATUS, STUDIO_STATUS } = require('../config/constants');
const { isAdmin, isStudio } = require('../utils/accessHelpers');
const { mergeOeffnungszeiten } = require('../config/studioDefaults');
const { normalizeAusnahmen } = require('../utils/studioHours');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

const PROFILE_FIELDS = ['firma', 'telefon', 'strasse', 'plz', 'ort', 'land', 'notizen'];

const formatRaum = (doc) => {
    const r = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(r._id),
        name: r.name,
        farbe: r.farbe ?? '#3B8BD4',
        aktiv: r.aktiv !== false,
        laser_brand: r.laser_brand ?? '',
        laser_model: r.laser_model ?? '',
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
        behandlungsraeume: (doc.behandlungsraeume ?? []).map(formatRaum),
        mitarbeiter: (doc.mitarbeiter ?? []).map(formatMitarbeiter),
        pufferzeit_minuten: doc.pufferzeit_minuten ?? 10,
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

const mapRoomsInput = (rooms = []) =>
    rooms.map((r) => ({
        ...(r.id && mongoose.Types.ObjectId.isValid(r.id) ? { _id: r.id } : {}),
        name: r.name,
        farbe: r.farbe ?? '#3B8BD4',
        aktiv: r.aktiv !== false,
        laser_brand: r.laser_brand ?? '',
        laser_model: r.laser_model ?? '',
    }));

const mapStaffInput = (staff = []) =>
    staff.map((m) => ({
        ...(m.id && mongoose.Types.ObjectId.isValid(m.id) ? { _id: m.id } : {}),
        vorname: m.vorname,
        nachname: m.nachname,
        rolle: m.rolle ?? 'Laser-Therapeutin',
        raum_id: m.raum_id ?? '',
        aktiv: m.aktiv !== false,
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
        behandlungsraeume,
        mitarbeiter,
        pufferzeit_minuten,
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

    if (behandlungsraeume !== undefined) {
        studio.behandlungsraeume = mapRoomsInput(behandlungsraeume);
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

    if (pufferzeit_minuten !== undefined) {
        studio.pufferzeit_minuten = pufferzeit_minuten;
    }

    await studio.save();

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
        standorte: (doc.standorte ?? []).map(formatPublicStandort),
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

module.exports = {
    formatStudioSettings,
    formatPublicStudio,
    getStudioSettings,
    patchStudioSettings,
    listStudiosAdmin,
    listPublicStudios,
    patchStudioStatus,
};

const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Studio = require('../models/studioModel');
const { USER_ROLES } = require('../config/constants');
const { isAdmin, isStudio } = require('../utils/accessHelpers');
const { mergeOeffnungszeiten } = require('../config/studioDefaults');

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
        behandlungsraeume: (doc.behandlungsraeume ?? []).map(formatRaum),
        mitarbeiter: (doc.mitarbeiter ?? []).map(formatMitarbeiter),
        pufferzeit_minuten: doc.pufferzeit_minuten ?? 10,
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

    const { profile, oeffnungszeiten, behandlungsraeume, mitarbeiter, pufferzeit_minuten } =
        req.body;

    if (profile) {
        applyProfilePatch(studio, profile);
    }

    if (oeffnungszeiten) {
        applyOeffnungszeitenPatch(studio, oeffnungszeiten);
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

module.exports = {
    formatStudioSettings,
    getStudioSettings,
    patchStudioSettings,
};

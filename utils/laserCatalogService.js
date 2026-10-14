const LaserDevice = require('../models/laserDeviceModel');
const PlatformConfig = require('../models/platformConfigModel');
const { LASER_CATALOG_DEFAULTS } = require('../config/laserCatalogDefaults');
const { colorDeltasForDevice } = require('../config/laserColorProfiles');
const {
    LASER_COLOR_KEYS,
    mergeLaserColorMaps,
    mergeSessionPrediction,
} = require('../config/sessionPredictionDefaults');
const {
    getPlatformConfigDoc,
    mergePlatformConfig,
    patchConfigDraft,
} = require('./configService');
const ApiError = require('./ApiError');

const SESSION_DOMAIN = 'session_prediction';

const pickColors = (map = {}) =>
    Object.fromEntries(
        LASER_COLOR_KEYS.map((key) => {
            const n = Number(map?.[key]);
            return [key, Number.isFinite(n) ? n : 0];
        })
    );

const sameColors = (a, b) => LASER_COLOR_KEYS.every((key) => a?.[key] === b?.[key]);

/**
 * LIVE and DRAFT session_prediction, the only store of laser colour deltas.
 * A draft's per-laser maps are layered onto LIVE exactly like publish does.
 */
const loadColorContext = async () => {
    const doc = await getPlatformConfigDoc();
    const live = mergePlatformConfig(doc).session_prediction;
    const draftData = doc.drafts?.[SESSION_DOMAIN]?.data;
    const draft = draftData
        ? mergeSessionPrediction({
              ...draftData,
              laser_color_overrides: mergeLaserColorMaps(
                  live.laser_color_overrides,
                  draftData.laser_color_overrides
              ),
          })
        : null;
    return { live, draft };
};

const effectiveColors = (cfg, deviceId) =>
    pickColors({
        ...(cfg?.tattoo_deltas?.color || {}),
        ...(cfg?.laser_color_overrides?.[deviceId] || {}),
    });

const colorStateFor = (ctx, deviceId) => {
    const live = effectiveColors(ctx.live, deviceId);
    const draft = ctx.draft ? effectiveColors(ctx.draft, deviceId) : null;
    const pending = Boolean(draft && !sameColors(draft, live));
    return {
        color_deltas: live,
        color_deltas_draft: pending ? draft : null,
        color_deltas_pending: pending,
    };
};

const formatLaserDevice = (doc, colorCtx = null) => {
    const d = doc?.toObject ? doc.toObject() : doc;
    if (!d) return null;
    const id = String(d._id);
    return {
        id,
        manufacturer: d.manufacturer,
        model: d.model,
        wavelengths_nm: Array.isArray(d.wavelengths_nm) ? d.wavelengths_nm : [],
        notes: d.notes || '',
        ...(colorCtx ? colorStateFor(colorCtx, id) : {}),
        active: Boolean(d.active),
        label: `${d.manufacturer} ${d.model}`.trim(),
        created_at: d.createdAt || null,
        updated_at: d.updatedAt || null,
    };
};

const setLiveLaserColors = async (entries) => {
    if (!entries.length) return;
    await getPlatformConfigDoc();
    const $set = Object.fromEntries(
        entries.map(([id, colors]) => [`${SESSION_DOMAIN}.laser_color_overrides.${id}`, colors])
    );
    await PlatformConfig.updateOne({ key: 'platform' }, { $set });
};

/**
 * One-time migration: devices without a complete LIVE colour map get the values the
 * engine already used for them (reference profile by name, else platform colours).
 * After this, laserColorProfiles.js is only a seed and never read at prediction time.
 */
const ensureLaserColorsSeeded = async (docs) => {
    const ctx = await loadColorContext();
    const stored = ctx.live.laser_color_overrides || {};
    const platformColors = ctx.live.tattoo_deltas?.color || {};
    const missing = docs
        .filter((doc) => {
            const entry = stored[String(doc._id)];
            return !entry || LASER_COLOR_KEYS.some((key) => entry[key] === undefined);
        })
        .map((doc) => [
            String(doc._id),
            pickColors({
                ...platformColors,
                ...(colorDeltasForDevice(doc.manufacturer, doc.model) || {}),
                ...(stored[String(doc._id)] || {}),
            }),
        ]);
    await setLiveLaserColors(missing);
    return missing.length;
};

const ensureLaserCatalogSeeded = async () => {
    const count = await LaserDevice.countDocuments();
    if (count > 0) return count;
    await LaserDevice.insertMany(
        LASER_CATALOG_DEFAULTS.map((row) => ({
            ...row,
            wavelengths_nm: [...(row.wavelengths_nm || [])],
        }))
    );
    return LASER_CATALOG_DEFAULTS.length;
};

const listLaserDevices = async ({ activeOnly = false } = {}) => {
    await ensureLaserCatalogSeeded();
    const allDocs = await LaserDevice.find({}).sort({ manufacturer: 1, model: 1 });
    await ensureLaserColorsSeeded(allDocs);
    const ctx = await loadColorContext();
    return allDocs
        .filter((doc) => !activeOnly || doc.active)
        .map((doc) => formatLaserDevice(doc, ctx));
};

/** Platform colour deltas a new laser starts from (LIVE value until a draft is published). */
const getDefaultLaserColors = async () => {
    const ctx = await loadColorContext();
    return pickColors(ctx.live.tattoo_deltas?.color || {});
};

const getLaserDeviceById = async (id, { requireActive = false } = {}) => {
    const doc = await LaserDevice.findById(id);
    if (!doc) throw new ApiError(404, 'Laser device not found');
    if (requireActive && !doc.active) {
        throw new ApiError(400, 'Laser device is inactive');
    }
    await ensureLaserColorsSeeded([doc]);
    return formatLaserDevice(doc, await loadColorContext());
};

const assertActiveLaserDeviceId = async (id) => {
    if (!id) return null;
    const formatted = await getLaserDeviceById(id, { requireActive: true });
    return formatted;
};

const createLaserDevice = async (payload, userId = null) => {
    let doc;
    try {
        doc = await LaserDevice.create({
            manufacturer: String(payload.manufacturer || '').trim(),
            model: String(payload.model || '').trim(),
            wavelengths_nm: payload.wavelengths_nm || [],
            notes: payload.notes || '',
            active: payload.active !== false,
            created_by: userId,
            updated_by: userId,
        });
    } catch (err) {
        if (err?.code === 11000) {
            throw new ApiError(409, 'A laser with this manufacturer and model already exists');
        }
        throw err;
    }
    // A new device is LIVE with the platform colours; its own deltas arrive via draft → publish.
    await setLiveLaserColors([[String(doc._id), await getDefaultLaserColors()]]);
    return formatLaserDevice(doc, await loadColorContext());
};

const updateLaserDevice = async (id, payload, userId = null) => {
    const doc = await LaserDevice.findById(id);
    if (!doc) throw new ApiError(404, 'Laser device not found');

    if (payload.manufacturer !== undefined) doc.manufacturer = String(payload.manufacturer).trim();
    if (payload.model !== undefined) doc.model = String(payload.model).trim();
    if (payload.wavelengths_nm !== undefined) doc.wavelengths_nm = payload.wavelengths_nm;
    if (payload.notes !== undefined) doc.notes = payload.notes;
    if (payload.active !== undefined) doc.active = Boolean(payload.active);
    doc.updated_by = userId;

    try {
        await doc.save();
    } catch (err) {
        if (err?.code === 11000) {
            throw new ApiError(409, 'A laser with this manufacturer and model already exists');
        }
        throw err;
    }
    return formatLaserDevice(doc, await loadColorContext());
};

/**
 * Laser profile colour edit → shared session_prediction DRAFT (never LIVE).
 * Returns true when the draft changed.
 */
const saveLaserColorDraft = async (deviceId, colors, { userId = null, label = '' } = {}) => {
    const next = pickColors(colors);
    const ctx = await loadColorContext();
    const current = effectiveColors(ctx.draft || ctx.live, deviceId);
    if (sameColors(current, next)) return false;
    await patchConfigDraft(
        SESSION_DOMAIN,
        { laser_color_overrides: { [deviceId]: next } },
        { userId, note: `Laser colour deltas: ${label || deviceId}` }
    );
    return true;
};

module.exports = {
    formatLaserDevice,
    ensureLaserCatalogSeeded,
    listLaserDevices,
    getLaserDeviceById,
    getDefaultLaserColors,
    assertActiveLaserDeviceId,
    createLaserDevice,
    updateLaserDevice,
    saveLaserColorDraft,
};

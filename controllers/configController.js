const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const mongoose = require('mongoose');
const Studio = require('../models/studioModel');
const {
    getPlatformConfig,
    updatePlatformConfig,
    getPublicConfig,
    formatStudioConfig,
    updateStudioConfig,
} = require('../utils/configService');
const { isAdmin, isStudio } = require('../utils/accessHelpers');
const { USER_ROLES } = require('../config/constants');

const assertValidStudioId = (studioId) => {
    if (
        !studioId ||
        !mongoose.Types.ObjectId.isValid(studioId) ||
        String(new mongoose.Types.ObjectId(studioId)) !== String(studioId)
    ) {
        throw new ApiError(
            400,
            'Invalid studioId. Use the Studio MongoDB ObjectId (24-char hex). Tip: GET /cases → copy the studio field from any case.'
        );
    }
};

const getPlatform = asyncHandler(async (_req, res) => {
    const config = await getPlatformConfig();

    res.status(200).json({
        success: true,
        data: { platform_config: config },
    });
});

const patchPlatform = asyncHandler(async (req, res) => {
    const config = await updatePlatformConfig(req.body);

    res.status(200).json({
        success: true,
        message: 'Platform config updated',
        data: { platform_config: config },
    });
});

const getPublic = asyncHandler(async (_req, res) => {
    const config = await getPublicConfig();

    res.status(200).json({
        success: true,
        data: { config },
    });
});

const resolveStudioForUser = async (user, studioIdParam) => {
    if (studioIdParam) {
        if (!isAdmin(user.role)) {
            throw new ApiError(403, 'Only admins can access config for other studios');
        }
        assertValidStudioId(studioIdParam);
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

const getStudioConfig = asyncHandler(async (req, res) => {
    const studio = await resolveStudioForUser(req.user, req.params.studioId);
    const platform = await getPlatformConfig();

    res.status(200).json({
        success: true,
        data: { studio_config: formatStudioConfig(studio, platform) },
    });
});

const patchStudioConfigHandler = asyncHandler(async (req, res) => {
    const studio = await resolveStudioForUser(req.user, req.params.studioId);

    if (!isAdmin(req.user.role) && req.user.role !== USER_ROLES.STUDIO_ADMIN) {
        throw new ApiError(403, 'Only studio admins can update studio config');
    }

    const studioConfig = await updateStudioConfig(studio._id, req.body);

    res.status(200).json({
        success: true,
        message: 'Studio config updated',
        data: { studio_config: studioConfig },
    });
});

module.exports = {
    getPlatform,
    patchPlatform,
    getPublic,
    getStudioConfig,
    patchStudioConfigHandler,
};

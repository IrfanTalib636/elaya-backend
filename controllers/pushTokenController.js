const asyncHandler = require('../utils/asyncHandler');
const User = require('../models/userModel');

/**
 * POST /push-tokens — register the device's Expo push token for the
 * authenticated user. A token is unique per device install, so it is moved
 * to the current user if another account registered it before (shared device).
 */
const registerPushToken = asyncHandler(async (req, res) => {
    const { token, platform } = req.body;

    await User.updateMany(
        { 'push_tokens.token': token },
        { $pull: { push_tokens: { token } } }
    );
    await User.updateOne(
        { _id: req.user._id },
        {
            $push: {
                push_tokens: {
                    token,
                    platform: platform || null,
                    updated_at: new Date(),
                },
            },
        }
    );

    res.status(200).json({
        success: true,
        message: 'Push token registered',
        data: {},
    });
});

/**
 * DELETE /push-tokens — remove the device's Expo push token (called on
 * logout so a signed-out device stops receiving notifications).
 */
const removePushToken = asyncHandler(async (req, res) => {
    const { token } = req.body;

    await User.updateOne(
        { _id: req.user._id },
        { $pull: { push_tokens: { token } } }
    );

    res.status(200).json({
        success: true,
        message: 'Push token removed',
        data: {},
    });
});

module.exports = {
    registerPushToken,
    removePushToken,
};

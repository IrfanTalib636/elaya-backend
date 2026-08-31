const express = require('express');
const pushTokenController = require('../controllers/pushTokenController');
const validateMiddleware = require('../middleware/validateMiddleware');
const {
    registerPushTokenSchema,
    removePushTokenSchema,
} = require('../validators/pushTokenValidator');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.use(protect);

/**
 * @swagger
 * /push-tokens:
 *   post:
 *     summary: Register the device's Expo push token
 *     description: |
 *       **Auth:** Bearer · **Who can call:** Any authenticated user
 *
 *       Registers the Expo push token of the calling device so the backend can
 *       send push notifications (chat messages, estimate confirmations). If the
 *       token was registered by another account (shared device), it is moved to
 *       the current user.
 *     tags: [PushTokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string, example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }
 *               platform: { type: string, enum: [ios, android] }
 *     responses:
 *       200:
 *         description: Push token registered
 *       400:
 *         description: Validation error
 *   delete:
 *     summary: Remove the device's Expo push token (logout)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** Any authenticated user
 *     tags: [PushTokens]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token: { type: string }
 *     responses:
 *       200:
 *         description: Push token removed
 */
router.post(
    '/',
    validateMiddleware(registerPushTokenSchema),
    pushTokenController.registerPushToken
);
router.delete(
    '/',
    validateMiddleware(removePushTokenSchema),
    pushTokenController.removePushToken
);

module.exports = router;

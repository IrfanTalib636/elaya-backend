const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const aiRateLimiter = require('../middleware/aiRateLimiter');
const { analyzeVerblassung } = require('../controllers/verblassungController');
const { verblassungAnalyzeSchema } = require('../validators/verblassungValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const STUDIO_AND_ADMIN = [
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * tags:
 *   name: Verblassung
 *   description: AI fading analysis (before/after progress photos). Anthropic key is server-side only.
 */

/**
 * @swagger
 * /verblassung:
 *   post:
 *     summary: Run KI Verblassungsanalyse for a session
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio, admin (not customer)
 *
 *       Compares the current session progress photo with the **previous treatment**
 *       progress photo. Not available for session 1 (no prior treatment photo, no API call).
 *       Intake photos are not used as the before-image.
 *       Persists `verblassung_prozent` + `verblassung_ki` on the session and syncs case `removal`.
 *
 *       Upload photos first via `POST /files/sessions/{sessionId}/progress`.
 *     tags: [Verblassung]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [session_id]
 *             properties:
 *               session_id: { type: string }
 *               foto_vorher_file_id: { type: string, nullable: true }
 *               foto_aktuell_file_id: { type: string, nullable: true }
 *               persist: { type: boolean, default: true }
 *     responses:
 *       200:
 *         description: Analysis result (ampel % + customer/studio texts)
 *       400:
 *         description: Missing progress photo
 *       403:
 *         description: Customer cannot run analysis
 */
router.post(
    '/',
    protect,
    authorize(...STUDIO_AND_ADMIN),
    aiRateLimiter,
    validateMiddleware(verblassungAnalyzeSchema),
    analyzeVerblassung
);

module.exports = router;

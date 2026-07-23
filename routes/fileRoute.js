const express = require('express');
const fileController = require('../controllers/fileController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { handleUpload } = require('../middleware/uploadMiddleware');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Files
 *   description: Private photo storage — VPS disk + MongoDB metadata. No public URLs.
 */

router.use(protect);

/**
 * @swagger
 * /files/staging:
 *   post:
 *     summary: Upload a photo to staging (private file ID)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio, admin
 *
 *       Multipart upload. Returns a private `id` — use it as `foto_file_id` (Nachsorge)
 *       or intake photo fields on cases. Images are never public URLs.
 *
 *       **Nachsorge:** set `slot=nachsorge`.
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: JPEG, PNG, or WebP (max ~5 MB)
 *               slot:
 *                 type: string
 *                 enum: [main, detail, marker, zone, nachsorge]
 *                 default: main
 *                 description: Use `nachsorge` for aftercare checks
 *               customer_id:
 *                 type: string
 *                 description: Required for studio uploading on behalf of a customer
 *     responses:
 *       201:
 *         description: Photo uploaded — use `data.id` as file asset ID
 *       400:
 *         description: Missing/invalid file or slot
 */
router.post(
    '/staging',
    authorize(...fileController.uploadRoles),
    handleUpload,
    fileController.uploadStaging
);

/**
 * @swagger
 * /files/cases/{caseId}/intake:
 *   post:
 *     summary: Upload intake photo linked to a case
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: caseId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               slot:
 *                 type: string
 *                 enum: [main, detail, marker, zone]
 *                 default: main
 *     responses:
 *       201:
 *         description: Intake photo uploaded
 */
router.post(
    '/cases/:caseId/intake',
    authorize(...fileController.uploadRoles),
    handleUpload,
    fileController.uploadCaseIntake
);

/**
 * @swagger
 * /files/sessions/{sessionId}/progress:
 *   post:
 *     summary: Upload session progress photo
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Progress photo uploaded
 */
router.post(
    '/sessions/:sessionId/progress',
    authorize(...fileController.uploadRoles),
    handleUpload,
    fileController.uploadSessionProgress
);

/**
 * @swagger
 * /files/{fileId}:
 *   get:
 *     summary: Get file metadata (no image bytes)
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: File metadata
 *       404:
 *         description: Not found
 *   delete:
 *     summary: Delete a staging file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */
router.get(
    '/:fileId',
    authorize(...fileController.readRoles),
    fileController.getFileMeta
);

/**
 * @swagger
 * /files/{fileId}/content:
 *   get:
 *     summary: Download/view private image bytes
 *     description: |
 *       Returns the image binary with the correct Content-Type.
 *       Auth required — do not treat this as a public CDN URL.
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Image bytes
 *         content:
 *           image/jpeg: {}
 *           image/png: {}
 *           image/webp: {}
 *       404:
 *         description: Not found
 */
router.get(
    '/:fileId/content',
    authorize(...fileController.readRoles),
    fileController.getFileContent
);

router.delete(
    '/:fileId',
    authorize(...fileController.uploadRoles),
    fileController.deleteStagingFile
);

module.exports = router;

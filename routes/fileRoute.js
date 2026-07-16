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

router.post(
    '/staging',
    authorize(...fileController.uploadRoles),
    handleUpload,
    fileController.uploadStaging
);

router.post(
    '/cases/:caseId/intake',
    authorize(...fileController.uploadRoles),
    handleUpload,
    fileController.uploadCaseIntake
);

router.post(
    '/sessions/:sessionId/progress',
    authorize(...fileController.uploadRoles),
    handleUpload,
    fileController.uploadSessionProgress
);

router.get(
    '/:fileId',
    authorize(...fileController.readRoles),
    fileController.getFileMeta
);

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

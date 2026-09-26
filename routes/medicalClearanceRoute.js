const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const { handleUpload } = require('../middleware/uploadMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const { z } = require('zod');
const { USER_ROLES } = require('../config/constants');
const ctrl = require('../controllers/medicalClearanceController');

const router = express.Router();

const STUDIO_AND_ADMIN = [
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.DEVELOPER,
];

const reviewSchema = z.object({
    decision: z.enum(['verify', 'reject']),
    note: z.string().max(2000).optional().default(''),
});

const antibioticAnswerSchema = z.object({
    appointment_id: z.string().min(1),
    still_on_antibiotics: z.boolean(),
    not_fully_recovered: z.boolean(),
});

router.use(protect);

/** Customer: own clearance status */
router.get('/me', authorize(USER_ROLES.CUSTOMER), ctrl.getMyClearance);

/** Customer: upload doctor's certificate */
router.post(
    '/me/upload',
    authorize(USER_ROLES.CUSTOMER),
    handleUpload,
    ctrl.uploadClearanceDocument
);

/** Customer: answer ~24h antibiotic / recovery check */
router.post(
    '/me/antibiotic-check',
    authorize(USER_ROLES.CUSTOMER),
    validateMiddleware(antibioticAnswerSchema),
    ctrl.answerAntibioticCheck
);

/** Studio: read customer clearance */
router.get(
    '/customers/:id',
    authorize(...STUDIO_AND_ADMIN),
    ctrl.getCustomerClearance
);

/** Studio: upload on behalf of customer (optional) */
router.post(
    '/customers/:id/upload',
    authorize(...STUDIO_AND_ADMIN),
    handleUpload,
    ctrl.uploadClearanceDocument
);

/** Studio: verify or reject document (unlock only on verify) */
router.patch(
    '/customers/:id/review',
    authorize(...STUDIO_AND_ADMIN),
    validateMiddleware(reviewSchema),
    ctrl.reviewCustomerClearance
);

module.exports = router;

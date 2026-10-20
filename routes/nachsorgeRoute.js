const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const aiRateLimiter = require('../middleware/aiRateLimiter');
const {
    photoCheck,
    createCheck,
    listChecks,
    getCheck,
    reviewCheck,
    contactStudio,
} = require('../controllers/nachsorgeController');
const {
    nachsorgePhotoCheckSchema,
    nachsorgeCheckSchema,
    listNachsorgeQuerySchema,
    nachsorgeReviewSchema,
    nachsorgeContactStudioSchema,
} = require('../validators/nachsorgeValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const CUSTOMER_AND_STUDIO = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

const STUDIO_AND_ADMIN = [
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.DEVELOPER,
];

router.post(
    '/photo-check',
    protect,
    authorize(...CUSTOMER_AND_STUDIO),
    aiRateLimiter,
    validateMiddleware(nachsorgePhotoCheckSchema),
    photoCheck
);

router.post(
    '/check',
    protect,
    authorize(...CUSTOMER_AND_STUDIO),
    aiRateLimiter,
    validateMiddleware(nachsorgeCheckSchema),
    createCheck
);


router.get(
    '/',
    protect,
    authorize(...CUSTOMER_AND_STUDIO),
    validateMiddleware(listNachsorgeQuerySchema, 'query'),
    listChecks
);


router.patch(
    '/:id/review',
    protect,
    authorize(...STUDIO_AND_ADMIN),
    validateMiddleware(nachsorgeReviewSchema),
    reviewCheck
);


router.post(
    '/:id/contact-studio',
    protect,
    authorize(...CUSTOMER_AND_STUDIO),
    validateMiddleware(nachsorgeContactStudioSchema),
    contactStudio
);


router.get('/:id', protect, authorize(...CUSTOMER_AND_STUDIO), getCheck);

module.exports = router;

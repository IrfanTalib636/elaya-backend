const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
    listCustomers,
    createCustomer,
    getCustomer,
    updateCustomer,
} = require('../controllers/customerController');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const STUDIO_AND_ADMIN = [
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

router
    .route('/')
    .get(protect, authorize(...STUDIO_AND_ADMIN), listCustomers)
    .post(protect, authorize(...STUDIO_AND_ADMIN), createCustomer);

router
    .route('/:id')
    .get(protect, authorize(...STUDIO_AND_ADMIN), getCustomer)
    .patch(protect, authorize(...STUDIO_AND_ADMIN), updateCustomer);

module.exports = router;

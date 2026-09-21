const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../config/constants');
const automationsController = require('../controllers/automationsController');

const router = express.Router();

router.get(
    '/me',
    protect,
    authorize(USER_ROLES.CUSTOMER),
    automationsController.getMyAutomations
);

router.post(
    '/me/check',
    protect,
    authorize(USER_ROLES.CUSTOMER),
    automationsController.checkMyAutomations
);

module.exports = router;

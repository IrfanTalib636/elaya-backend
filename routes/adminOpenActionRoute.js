const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../config/constants');
const {
    listAdminOpenActions,
    adminOpenActionSummary,
} = require('../controllers/openActionController');

const router = express.Router();
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

router.get('/summary', protect, authorize(...adminRoles), adminOpenActionSummary);
router.get('/', protect, authorize(...adminRoles), listAdminOpenActions);

module.exports = router;

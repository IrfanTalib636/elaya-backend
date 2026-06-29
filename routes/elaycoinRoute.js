const express = require('express');
const elaycoinController = require('../controllers/elaycoinController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const studioAndAdminRoles = [
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * /elaycoins/me:
 *   get:
 *     summary: Get own Elaycoin balance and transactions
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer only
 *
 *       Full expiry warning levels. Applies 12-month expiry check on read. Studio/admin — use GET /elaycoins/customers/{customerId}.
 *     tags: [Elaycoins]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Elaycoin account data
 *       403:
 *         description: Not a customer
 */
router.get('/me', protect, authorize(USER_ROLES.CUSTOMER), elaycoinController.getMyElaycoins);

/**
 * @swagger
 * /elaycoins/customers/{customerId}:
 *   get:
 *     summary: Get customer Elaycoins (studio/admin)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Studio-scoped read-only view. Path param must be Customer document ID (from GET /auth/me → customer_id), not User ID.
 *     tags: [Elaycoins]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Customer Elaycoin account
 *       403:
 *         description: No access to this customer
 */
router.get(
    '/customers/:customerId',
    protect,
    authorize(...studioAndAdminRoles),
    elaycoinController.getCustomerElaycoins
);

module.exports = router;

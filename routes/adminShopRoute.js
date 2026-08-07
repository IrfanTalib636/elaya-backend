const express = require('express');
const shopAdminController = require('../controllers/shopAdminController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');
const {
    adminProductCreateSchema,
    adminProductUpdateSchema,
    adminListProductsQuerySchema,
    adminListOrdersQuerySchema,
    patchCommissionSchema,
} = require('../validators/shopAdminValidator');

const router = express.Router();
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

router.use(protect, authorize(...adminRoles));

router.get('/products', validate(adminListProductsQuerySchema, 'query'), shopAdminController.listProductsAdmin);
router.post('/products', validate(adminProductCreateSchema), shopAdminController.createProduct);
router.patch('/products/:id', validate(adminProductUpdateSchema), shopAdminController.updateProduct);

router.get('/orders', validate(adminListOrdersQuerySchema, 'query'), shopAdminController.listOrdersAdmin);
router.patch(
    '/orders/:id/commission',
    validate(patchCommissionSchema),
    shopAdminController.patchOrderCommission
);

router.get('/finance', shopAdminController.getShopFinanceSummary);
router.get('/shipping', shopAdminController.getShippingAdmin);

module.exports = router;

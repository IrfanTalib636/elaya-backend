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
/** Product catalog + commission payouts: super admin only. */
const shopWriteRoles = [USER_ROLES.SUPER_ADMIN];

router.use(protect, authorize(...adminRoles));

router.get('/products', validate(adminListProductsQuerySchema, 'query'), shopAdminController.listProductsAdmin);
router.post('/products', authorize(...shopWriteRoles), validate(adminProductCreateSchema), shopAdminController.createProduct);
router.patch('/products/:id', authorize(...shopWriteRoles), validate(adminProductUpdateSchema), shopAdminController.updateProduct);

router.get('/orders', validate(adminListOrdersQuerySchema, 'query'), shopAdminController.listOrdersAdmin);
router.patch(
    '/orders/:id/commission',
    authorize(...shopWriteRoles),
    validate(patchCommissionSchema),
    shopAdminController.patchOrderCommission
);

router.get('/finance', shopAdminController.getShopFinanceSummary);
router.get('/finance/studios/:studioId', shopAdminController.getStudioFinanceDetail);
router.patch(
    '/finance/studios/:studioId',
    authorize(...shopWriteRoles),
    shopAdminController.patchStudioFinanceTerms
);
router.get('/shipping', shopAdminController.getShippingAdmin);
router.patch(
    '/shipping',
    authorize(...shopWriteRoles),
    shopAdminController.patchShopCatalogAdmin
);

module.exports = router;

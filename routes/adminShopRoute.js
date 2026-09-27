const express = require('express');
const shopAdminController = require('../controllers/shopAdminController');
const { protect, authorize } = require('../middleware/authMiddleware');
const { handleShopImagesUpload } = require('../middleware/uploadMiddleware');
const validate = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');
const {
    adminProductCreateSchema,
    adminProductUpdateSchema,
    adminListProductsQuerySchema,
    adminListOrdersQuerySchema,
    patchCommissionSchema,
    adminListPromotionsQuerySchema,
    adminPromotionCreateSchema,
    adminPromotionUpdateSchema,
} = require('../validators/shopAdminValidator');

const router = express.Router();
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];
/** Product catalog + commission payouts + promotions: super admin only. */
const shopWriteRoles = [USER_ROLES.SUPER_ADMIN];

router.use(protect, authorize(...adminRoles));

router.get('/products', validate(adminListProductsQuerySchema, 'query'), shopAdminController.listProductsAdmin);
router.post('/products', authorize(...shopWriteRoles), validate(adminProductCreateSchema), shopAdminController.createProduct);
router.patch('/products/:id', authorize(...shopWriteRoles), validate(adminProductUpdateSchema), shopAdminController.updateProduct);

/** Multipart upload of one or more product photos — field name "files". Returns public URLs to attach to product.bilder. */
router.post(
    '/products/upload-image',
    authorize(...shopWriteRoles),
    handleShopImagesUpload,
    shopAdminController.uploadProductImages
);
router.delete(
    '/products/:id/images',
    authorize(...shopWriteRoles),
    shopAdminController.removeProductImage
);

router.get('/orders', validate(adminListOrdersQuerySchema, 'query'), shopAdminController.listOrdersAdmin);
router.patch(
    '/orders/:id/commission',
    authorize(...shopWriteRoles),
    validate(patchCommissionSchema),
    shopAdminController.patchOrderCommission
);

/** Platform-wide general promotions (apply to all products unless excluded). */
router.get(
    '/promotions',
    validate(adminListPromotionsQuerySchema, 'query'),
    shopAdminController.listPromotionsAdmin
);
router.post(
    '/promotions',
    authorize(...shopWriteRoles),
    validate(adminPromotionCreateSchema),
    shopAdminController.createPromotion
);
router.patch(
    '/promotions/:id',
    authorize(...shopWriteRoles),
    validate(adminPromotionUpdateSchema),
    shopAdminController.updatePromotion
);
router.delete(
    '/promotions/:id',
    authorize(...shopWriteRoles),
    shopAdminController.deletePromotion
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

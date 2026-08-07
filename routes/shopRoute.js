const express = require('express');
const shopCustomerController = require('../controllers/shopCustomerController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const {
    listProductsQuerySchema,
    createShopOrderSchema,
    shippingQuoteSchema,
} = require('../validators/shopValidator');
const { USER_ROLES } = require('../config/constants');
const { paginationQueryFields } = require('../validators/paginationValidator');
const { z } = require('zod');

const router = express.Router();

const customerOnly = [USER_ROLES.CUSTOMER];
const catalogRoles = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * tags:
 *   name: Shop
 *   description: ElayShop catalog, shipping, and customer checkout
 */

router.get(
    '/payment-config',
    protect,
    authorize(...catalogRoles),
    shopCustomerController.getShopPaymentConfig
);

/**
 * @swagger
 * /shop/products:
 *   get:
 *     summary: List active ElayShop products
 *     tags: [Shop]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: kategorie
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Product catalog
 */
router.get(
    '/products',
    protect,
    authorize(...catalogRoles),
    validate(listProductsQuerySchema, 'query'),
    shopCustomerController.listProducts
);

/**
 * @swagger
 * /shop/products/{id}:
 *   get:
 *     summary: Get one product by id, product_code, or artikelnummer
 *     tags: [Shop]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Product detail
 *       404:
 *         description: Not found
 */
router.get(
    '/products/:id',
    protect,
    authorize(...catalogRoles),
    shopCustomerController.getProduct
);

/**
 * @swagger
 * /shop/shipping:
 *   get:
 *     summary: Shipping rates and quote for a country / cart total
 *     tags: [Shop]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: land
 *         schema: { type: string, example: Schweiz }
 *       - in: query
 *         name: warenwert
 *         schema: { type: number, example: 80 }
 *     responses:
 *       200:
 *         description: Shipping config + quote
 */
router.get(
    '/shipping',
    protect,
    authorize(...catalogRoles),
    validate(shippingQuoteSchema, 'query'),
    shopCustomerController.getShipping
);

/**
 * @swagger
 * /shop/orders:
 *   get:
 *     summary: List own shop orders (customer)
 *     tags: [Shop]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Order history
 *   post:
 *     summary: Place shop order (3-step checkout final step)
 *     description: |
 *       Cart is client-side. Server validates products, prices, shipping, and creates the order.
 *       Payment is simulated (MVP / prototype parity). Studio commission 25% on warenwert.
 *     tags: [Shop]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items, lieferadresse]
 *             properties:
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     produkt_id: { type: string }
 *                     menge: { type: integer }
 *               lieferadresse:
 *                 type: object
 *               zahlungsart:
 *                 type: string
 *                 enum: [karte, twint]
 *     responses:
 *       201:
 *         description: Order created
 */
router.get(
    '/orders',
    protect,
    authorize(...customerOnly),
    validate(z.object({ ...paginationQueryFields }), 'query'),
    shopCustomerController.listMyOrders
);

router.post(
    '/orders',
    protect,
    authorize(...customerOnly),
    validate(createShopOrderSchema),
    shopCustomerController.createOrder
);

router.post(
    '/orders/:id/confirm-payment',
    protect,
    authorize(...customerOnly),
    shopCustomerController.confirmOrderPayment
);

/**
 * @swagger
 * /shop/orders/{id}:
 *   get:
 *     summary: Get own shop order by id
 *     tags: [Shop]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Order detail
 */
router.get(
    '/orders/:id',
    protect,
    authorize(...customerOnly),
    shopCustomerController.getMyOrder
);

module.exports = router;

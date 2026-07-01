const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const {
    listCustomers,
    createCustomer,
    getCustomer,
    updateCustomer,
} = require('../controllers/customerController');
const {
    createCustomerSchema,
    updateCustomerSchema,
    listCustomersQuerySchema,
} = require('../validators/customerValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const STUDIO_AND_ADMIN = [
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * /customers:
 *   get:
 *     summary: List customers (studio-scoped)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Studio users see only their own customers. Supports search and pipeline_stufe filter.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search by name, email or phone
 *       - in: query
 *         name: pipeline_stufe
 *         schema: { type: string, enum: [Neu, "Beratung geplant", "Behandlung aktiv", "Beratung erledigt"] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated customer list
 */

/**
 * @swagger
 * /customers:
 *   post:
 *     summary: Create a customer
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Creates a User (role=customer) + Customer profile. Studio is inferred from the caller's session.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vorname, nachname, email, telefon]
 *             properties:
 *               vorname:      { type: string }
 *               nachname:     { type: string }
 *               email:        { type: string, format: email }
 *               telefon:      { type: string }
 *               geburtsdatum: { type: string, format: date }
 *               strasse:      { type: string }
 *               plz:          { type: string }
 *               ort:          { type: string }
 *               land:         { type: string, default: Schweiz }
 *               notizen:      { type: string }
 *     responses:
 *       201:
 *         description: Customer created
 */
router
    .route('/')
    .get(protect,  authorize(...STUDIO_AND_ADMIN), validateMiddleware(listCustomersQuerySchema, 'query'), listCustomers)
    .post(protect, authorize(...STUDIO_AND_ADMIN), validateMiddleware(createCustomerSchema),               createCustomer);

/**
 * @swagger
 * /customers/{id}:
 *   get:
 *     summary: Get customer by ID
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Returns customer profile + cases summary. Studio users can only access their own customers.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Customer with cases
 *       404:
 *         description: Customer not found
 */

/**
 * @swagger
 * /customers/{id}:
 *   patch:
 *     summary: Update customer fields
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Studio users can update personal info, address, notes, and pipeline_stufe.
 *       Admin-only fields: akquise_quelle, aktuelle_firma_id.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vorname:        { type: string }
 *               nachname:       { type: string }
 *               telefon:        { type: string }
 *               geburtsdatum:   { type: string, format: date }
 *               strasse:        { type: string }
 *               plz:            { type: string }
 *               ort:            { type: string }
 *               land:           { type: string }
 *               notizen:        { type: string }
 *               pipeline_stufe: { type: string }
 *     responses:
 *       200:
 *         description: Customer updated
 *       404:
 *         description: Customer not found
 */
router
    .route('/:id')
    .get(protect,   authorize(...STUDIO_AND_ADMIN), getCustomer)
    .patch(protect, authorize(...STUDIO_AND_ADMIN), validateMiddleware(updateCustomerSchema), updateCustomer);

module.exports = router;

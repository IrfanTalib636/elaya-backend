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
const { updateCustomerMeSchema } = require('../validators/customerMeValidator');
const {
    updateMe,
    exportMe,
    exportTransferProtocol,
} = require('../controllers/customerMeController');
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
 * /customers/me:
 *   patch:
 *     summary: Update own customer profile (mobile)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer only
 *
 *       Edit vorname, nachname, telefon, address, geburtsdatum, email. Send at least one field.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             minProperties: 1
 *             properties:
 *               vorname:      { type: string, example: Maria }
 *               nachname:     { type: string, example: Muster }
 *               email:        { type: string, format: email, example: maria@example.com }
 *               telefon:      { type: string, example: "+41 79 123 45 67" }
 *               geburtsdatum: { type: string, format: date, example: "1990-05-15" }
 *               strasse:      { type: string, example: Bahnhofstrasse 1 }
 *               plz:          { type: string, example: "8001" }
 *               ort:          { type: string, example: Zürich }
 *               land:         { type: string, example: Schweiz }
 *           example:
 *             vorname: Maria
 *             nachname: Muster
 *             telefon: "+41 79 123 45 67"
 *             strasse: Bahnhofstrasse 1
 *             plz: "8001"
 *             ort: Zürich
 *             land: Schweiz
 *     responses:
 *       200:
 *         description: Profile updated
 *       400:
 *         description: Validation error (empty body or invalid email)
 *       409:
 *         description: Email already in use
 */

/**
 * @swagger
 * /customers/me/export:
 *   get:
 *     summary: DSG data export (JSON download)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer only
 *
 *       Returns profile, case summaries, studio history, and Elaycoin balance as JSON attachment.
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: JSON export file
 */

/**
 * @swagger
 * /customers/me/transfer-protocol:
 *   get:
 *     summary: Studio transfer protocol (JSON download)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer only
 *
 *       Available after an admin-approved studio transfer (`genehmigt`).
 *     tags: [Customers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Transfer protocol JSON
 *       404:
 *         description: No approved transfer found
 */

router
    .route('/me')
    .patch(
        protect,
        authorize(USER_ROLES.CUSTOMER),
        validateMiddleware(updateCustomerMeSchema),
        updateMe
    );

router
    .route('/me/export')
    .get(protect, authorize(USER_ROLES.CUSTOMER), exportMe);

router
    .route('/me/transfer-protocol')
    .get(protect, authorize(USER_ROLES.CUSTOMER), exportTransferProtocol);

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

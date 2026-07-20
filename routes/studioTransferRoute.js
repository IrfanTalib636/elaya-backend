const express = require('express');
const studioTransferController = require('../controllers/studioTransferController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const {
    createStudioTransferSchema,
    listStudioTransfersQuerySchema,
    rejectStudioTransferSchema,
} = require('../validators/studioTransferValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const customerOnly = [USER_ROLES.CUSTOMER];
const adminOnly = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];
const studioReadOnly = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const studioAndAdmin = [...studioReadOnly, ...adminOnly];
const allTransferRoles = [...customerOnly, ...studioAndAdmin];

/**
 * @swagger
 * tags:
 *   name: StudioTransfers
 *   description: Customer studio transfer (Firmenwechsel) requests
 */

/**
 * @swagger
 * /studio-transfers:
 *   post:
 *     summary: Request a studio transfer
 *     description: |
 *       **Auth:** Bearer · **Who:** customer
 *
 *       Customer picks a target studio (`zu_firma_id`), confirms 3 consents, and signs.
 *       Creates status `ausstehend`. **Elaya platform admin** must approve (handoff §10.15).
 *       Customer is not switched until admin approves. Studio list for picker: `GET /studios/public`.
 *     tags: [StudioTransfers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - zu_firma_id
 *               - einwilligung_akte
 *               - einwilligung_datenschutz
 *               - einwilligung_bestaetigung
 *               - einwilligung_unterschrift
 *             properties:
 *               zu_firma_id: { type: string }
 *               einwilligung_akte: { type: boolean, enum: [true] }
 *               einwilligung_datenschutz: { type: boolean, enum: [true] }
 *               einwilligung_bestaetigung: { type: boolean, enum: [true] }
 *               einwilligung_unterschrift:
 *                 type: string
 *                 description: Base64 image data URI (max ~64KB)
 *     responses:
 *       201:
 *         description: Request created
 *       409:
 *         description: Pending request already exists
 */
router.post(
    '/',
    protect,
    authorize(...customerOnly),
    validate(createStudioTransferSchema),
    studioTransferController.createTransfer
);

/**
 * @swagger
 * /studio-transfers/me:
 *   get:
 *     summary: List my transfer requests
 *     tags: [StudioTransfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ausstehend, genehmigt, abgelehnt] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated transfers
 */
router.get(
    '/me',
    protect,
    authorize(...customerOnly),
    validate(listStudioTransfersQuerySchema, 'query'),
    studioTransferController.listMyTransfers
);

/**
 * @swagger
 * /studio-transfers:
 *   get:
 *     summary: List transfer requests (studio inbound + outbound, admin all)
 *     description: |
 *       **Studio:** sees requests where they are the target (`eingehend`) or source (`ausgehend`).
 *       **Admin:** sees all requests.
 *     tags: [StudioTransfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ausstehend, genehmigt, abgelehnt] }
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Paginated transfers
 */
router.get(
    '/',
    protect,
    authorize(...studioAndAdmin),
    validate(listStudioTransfersQuerySchema, 'query'),
    studioTransferController.listTransfers
);

/**
 * @swagger
 * /studio-transfers/{id}:
 *   get:
 *     summary: Get one transfer request
 *     tags: [StudioTransfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Transfer detail
 *       404:
 *         description: Not found
 */
router.get(
    '/:id',
    protect,
    authorize(...allTransferRoles),
    studioTransferController.getTransfer
);

/**
 * @swagger
 * /studio-transfers/{id}/approve:
 *   patch:
 *     summary: Approve transfer (Elaya admin / super_admin only)
 *     description: |
 *       Handoff §10.15 — only platform admin may approve. Activates Shared Case Layer:
 *       sets `aktuelle_firma_id` → target, `akquise_quelle` → `studio_wechsel`, updates `firma_history`.
 *       Status → `genehmigt`.
 *     tags: [StudioTransfers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Approved
 */
router.patch(
    '/:id/approve',
    protect,
    authorize(...adminOnly),
    studioTransferController.approveTransfer
);

/**
 * @swagger
 * /studio-transfers/{id}/reject:
 *   patch:
 *     summary: Reject transfer (Elaya admin / super_admin only)
 *     tags: [StudioTransfers]
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
 *             required: [ablehnungsgrund]
 *             properties:
 *               ablehnungsgrund: { type: string }
 *     responses:
 *       200:
 *         description: Rejected
 */
router.patch(
    '/:id/reject',
    protect,
    authorize(...adminOnly),
    validate(rejectStudioTransferSchema),
    studioTransferController.rejectTransfer
);

module.exports = router;

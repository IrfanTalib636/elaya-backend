const express = require('express');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const {
    getStudioSettings,
    patchStudioSettings,
    listStudiosAdmin,
    patchStudioStatus,
} = require('../controllers/studioController');
const {
    getCrmPipeline,
    listCrmTasks,
    createCrmTask,
    updateCrmTask,
    deleteCrmTask,
    listCrmNotes,
    createCrmNote,
    getCrmTemplate,
} = require('../controllers/crmController');
const { patchStudioSettingsSchema, listAdminStudiosQuerySchema, patchStudioStatusSchema } = require('../validators/studioValidator');
const {
    createCrmTaskSchema,
    updateCrmTaskSchema,
    createCrmNoteSchema,
} = require('../validators/crmValidator');
const { listShopOrders, patchShopOrderStatus } = require('../controllers/shopController');
const { getStudioAnalyticsSummary } = require('../controllers/studioAnalyticsController');
const {
    listShopOrdersQuerySchema,
    patchShopOrderStatusSchema,
    analyticsQuerySchema,
} = require('../validators/shopValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const studioRoles = [USER_ROLES.STUDIO_ADMIN, USER_ROLES.STUDIO_STAFF];
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

/**
 * @swagger
 * /studio/admin/studios:
 *   get:
 *     summary: List studios for admin approval (admin)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** admin, super_admin
 *
 *       Filter by status (e.g. ausstehend) to review pending studio registrations.
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [ausstehend, aktiv, gesperrt] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated studio list
 */
router.get(
    '/admin/studios',
    protect,
    authorize(...adminRoles),
    validateMiddleware(listAdminStudiosQuerySchema, 'query'),
    listStudiosAdmin
);

/**
 * @swagger
 * /studio/admin/studios/{studioId}/status:
 *   patch:
 *     summary: Approve, reject, or lock a studio (admin)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** admin, super_admin
 *
 *       Sets studio status and syncs the owner + studio user accounts (aktiv / ausstehend / gesperrt).
 *       Use status `aktiv` to approve a pending studio registration.
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studioId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [ausstehend, aktiv, gesperrt] }
 *               notizen: { type: string }
 *     responses:
 *       200:
 *         description: Studio status updated
 */
router.patch(
    '/admin/studios/:studioId/status',
    protect,
    authorize(...adminRoles),
    validateMiddleware(patchStudioStatusSchema),
    patchStudioStatus
);

/**
 * @swagger
 * /studio/settings:
 *   get:
 *     summary: Get own studio settings (profile, hours, rooms, staff)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff
 *
 *       Returns profile, opening hours, treatment rooms, staff roster, and buffer time.
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Studio settings
 *       403:
 *         description: Studio account required
 */
router.get(
    '/settings',
    protect,
    authorize(...studioRoles),
    getStudioSettings
);

/**
 * @swagger
 * /studio/settings:
 *   patch:
 *     summary: Update own studio settings
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin only
 *
 *       Partial update — send only the sections you want to change.
 *       `behandlungsraeume` and `mitarbeiter` replace the full arrays when provided.
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profile:
 *                 type: object
 *                 properties:
 *                   firma: { type: string }
 *                   telefon: { type: string }
 *                   strasse: { type: string }
 *                   plz: { type: string }
 *                   ort: { type: string }
 *                   land: { type: string }
 *                   notizen: { type: string }
 *               oeffnungszeiten:
 *                 type: object
 *               behandlungsraeume:
 *                 type: array
 *               mitarbeiter:
 *                 type: array
 *               pufferzeit_minuten:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Updated studio settings
 *       403:
 *         description: Studio admin required
 */
router.patch(
    '/settings',
    protect,
    authorize(USER_ROLES.STUDIO_ADMIN),
    validateMiddleware(patchStudioSettingsSchema),
    patchStudioSettings
);

/**
 * @swagger
 * /studio/studios/{studioId}/settings:
 *   get:
 *     summary: Get studio settings by ID (admin)
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studioId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Studio settings
 */
router.get(
    '/studios/:studioId/settings',
    protect,
    authorize(...adminRoles),
    getStudioSettings
);

/**
 * @swagger
 * /studio/studios/{studioId}/settings:
 *   patch:
 *     summary: Update studio settings by ID (admin)
 *     tags: [Studio]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studioId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Updated studio settings
 */
router.patch(
    '/studios/:studioId/settings',
    protect,
    authorize(...adminRoles),
    validateMiddleware(patchStudioSettingsSchema),
    patchStudioSettings
);

/**
 * @swagger
 * /studio/crm/pipeline:
 *   get:
 *     summary: CRM pipeline kanban data
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff
 *
 *       Auto-syncs pipeline_stufe from cases/appointments/sessions, then returns
 *       customers grouped by pipeline stage.
 *     tags: [Studio, CRM]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pipeline columns with customers
 */
router.get(
    '/crm/pipeline',
    protect,
    authorize(...studioRoles, ...adminRoles),
    getCrmPipeline
);

/**
 * @swagger
 * /studio/crm/tasks:
 *   get:
 *     summary: List CRM tasks (Aufgaben)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Returns studio-scoped follow-up tasks. Filter by customer and open/done status.
 *       Default `status=open` returns only incomplete tasks.
 *     tags: [Studio, CRM]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: customer_id
 *         schema: { type: string }
 *         description: Filter tasks for one customer (MongoDB ObjectId)
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, done, all], default: open }
 *         description: open = not done · done = completed · all = both
 *       - in: query
 *         name: studio_id
 *         schema: { type: string }
 *         description: Required for admin/super_admin when scoping a studio
 *     responses:
 *       200:
 *         description: Task list sorted by due date
 *       403:
 *         description: Studio access required
 */
router.get(
    '/crm/tasks',
    protect,
    authorize(...studioRoles, ...adminRoles),
    listCrmTasks
);

/**
 * @swagger
 * /studio/crm/tasks:
 *   post:
 *     summary: Create a CRM task
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Creates a follow-up task (call, email, appointment reminder, etc.).
 *       `customer_id` is optional — omit or null for a studio-wide task.
 *     tags: [Studio, CRM]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [titel, faellig_am]
 *             properties:
 *               customer_id:
 *                 type: string
 *                 nullable: true
 *                 description: Customer ObjectId, or null for general task
 *               titel:
 *                 type: string
 *                 maxLength: 200
 *                 example: Follow-up nach Beratung anrufen
 *               typ:
 *                 type: string
 *                 enum: [followup, anruf, email, termin, sonstiges]
 *                 default: followup
 *               prioritaet:
 *                 type: string
 *                 enum: [niedrig, mittel, hoch]
 *                 default: mittel
 *               faellig_am:
 *                 type: string
 *                 format: date
 *                 example: '2026-07-10'
 *               zugewiesen_an:
 *                 type: string
 *                 maxLength: 100
 *                 description: Optional staff name or id
 *     responses:
 *       201:
 *         description: Task created
 *       400:
 *         description: Validation error or invalid date
 *       404:
 *         description: Customer not found in studio
 */
router.post(
    '/crm/tasks',
    protect,
    authorize(...studioRoles, ...adminRoles),
    validateMiddleware(createCrmTaskSchema),
    createCrmTask
);

/**
 * @swagger
 * /studio/crm/tasks/{id}:
 *   patch:
 *     summary: Update a CRM task
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Partial update. Set `erledigt: true` to mark complete (sets `erledigt_am` automatically).
 *     tags: [Studio, CRM]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Task ObjectId
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               titel: { type: string, maxLength: 200 }
 *               typ:
 *                 type: string
 *                 enum: [followup, anruf, email, termin, sonstiges]
 *               prioritaet:
 *                 type: string
 *                 enum: [niedrig, mittel, hoch]
 *               faellig_am: { type: string, format: date }
 *               zugewiesen_an: { type: string, maxLength: 100 }
 *               erledigt: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated task
 *       404:
 *         description: Task not found
 */
router.patch(
    '/crm/tasks/:id',
    protect,
    authorize(...studioRoles, ...adminRoles),
    validateMiddleware(updateCrmTaskSchema),
    updateCrmTask
);

/**
 * @swagger
 * /studio/crm/tasks/{id}:
 *   delete:
 *     summary: Delete a CRM task
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Permanently removes the task from the studio CRM inbox.
 *     tags: [Studio, CRM]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Task deleted
 *       404:
 *         description: Task not found
 */
router.delete(
    '/crm/tasks/:id',
    protect,
    authorize(...studioRoles, ...adminRoles),
    deleteCrmTask
);

/**
 * @swagger
 * /studio/crm/notes:
 *   get:
 *     summary: List CRM contact notes for a customer
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Returns CRM contact log entries (calls, emails, meetings) for one customer,
 *       newest first. Separate from the customer's static `notizen` field on the profile.
 *     tags: [Studio, CRM]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: customer_id
 *         required: true
 *         schema: { type: string }
 *         description: Customer ObjectId
 *       - in: query
 *         name: studio_id
 *         schema: { type: string }
 *         description: Required for admin/super_admin
 *     responses:
 *       200:
 *         description: Notes timeline
 *       400:
 *         description: customer_id is required
 *       404:
 *         description: Customer not found
 */
router.get(
    '/crm/notes',
    protect,
    authorize(...studioRoles, ...adminRoles),
    listCrmNotes
);

/**
 * @swagger
 * /studio/crm/notes:
 *   post:
 *     summary: Create a CRM contact note
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Logs a contact event (phone call, email, meeting). Updates the customer's
 *       `letzter_kontakt` on the pipeline view. Optionally creates a linked follow-up task
 *       in the same request via the `aufgabe` object.
 *     tags: [Studio, CRM]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [customer_id, inhalt]
 *             properties:
 *               customer_id:
 *                 type: string
 *                 description: Customer ObjectId
 *               typ:
 *                 type: string
 *                 enum: [anruf, email, meeting, sonstiges]
 *                 default: anruf
 *               inhalt:
 *                 type: string
 *                 maxLength: 5000
 *                 example: Telefonisch erreicht — möchte Termin nächste Woche
 *               aufgabe:
 *                 type: object
 *                 description: Optional follow-up task created together with the note
 *                 required: [titel]
 *                 properties:
 *                   titel: { type: string, maxLength: 200 }
 *                   typ:
 *                     type: string
 *                     enum: [followup, anruf, email, termin, sonstiges]
 *                   prioritaet:
 *                     type: string
 *                     enum: [niedrig, mittel, hoch]
 *                   faellig_am: { type: string, format: date }
 *     responses:
 *       201:
 *         description: Note created (and optional task)
 *       404:
 *         description: Customer not found
 */
router.post(
    '/crm/notes',
    protect,
    authorize(...studioRoles, ...adminRoles),
    validateMiddleware(createCrmNoteSchema),
    createCrmNote
);

/**
 * @swagger
 * /studio/crm/templates/{customerId}:
 *   get:
 *     summary: Get stage-based message template for a customer
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Returns a pre-written German outreach message based on the customer's current
 *       `pipeline_stufe` and first name. Used by the CRM "Vorlage" button — copy to
 *       clipboard and paste into WhatsApp/email (no send from API yet).
 *     tags: [Studio, CRM]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: customerId
 *         required: true
 *         schema: { type: string }
 *         description: Customer ObjectId
 *       - in: query
 *         name: studio_id
 *         schema: { type: string }
 *         description: Required for admin/super_admin
 *     responses:
 *       200:
 *         description: Template text and recommended action for the customer's stage
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     pipeline_stufe: { type: string }
 *                     aktion: { type: string }
 *                     template_text: { type: string }
 *       404:
 *         description: Customer not found
 */
router.get(
    '/crm/templates/:customerId',
    protect,
    authorize(...studioRoles, ...adminRoles),
    getCrmTemplate
);

/**
 * @swagger
 * /studio/shop/orders:
 *   get:
 *     summary: List ElayShop orders for the studio
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Order history for analytics and shipping. Studio can update status only via PATCH.
 *     tags: [Studio, Shop]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [bestellt, versendet, geliefert] }
 *     responses:
 *       200:
 *         description: Paginated shop orders
 */
router.get(
    '/shop/orders',
    protect,
    authorize(...studioRoles, ...adminRoles),
    validateMiddleware(listShopOrdersQuerySchema, 'query'),
    listShopOrders
);

/**
 * @swagger
 * /studio/shop/orders/{id}:
 *   patch:
 *     summary: Update shop order shipping status
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Studio may **only** change `status` (bestellt → versendet → geliefert).
 *     tags: [Studio, Shop]
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
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [bestellt, versendet, geliefert]
 *     responses:
 *       200:
 *         description: Updated order
 *       404:
 *         description: Order not found
 */
router.patch(
    '/shop/orders/:id',
    protect,
    authorize(...studioRoles, ...adminRoles),
    validateMiddleware(patchShopOrderStatusSchema),
    patchShopOrderStatus
);

/**
 * @swagger
 * /studio/analytics/summary:
 *   get:
 *     summary: Studio analytics summary (revenue, fees, shop, coins)
 *     description: |
 *       **Auth:** Bearer · **Who can call:** studio_admin, studio_staff, admin, super_admin
 *
 *       Aggregates treatment revenue by acquisition source, 3% platform fee,
 *       shop commission, Elaycoin stats, and approximate netto for the period.
 *     tags: [Studio, Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Analytics summary
 */
router.get(
    '/analytics/summary',
    protect,
    authorize(...studioRoles, ...adminRoles),
    validateMiddleware(analyticsQuerySchema, 'query'),
    getStudioAnalyticsSummary
);

module.exports = router;

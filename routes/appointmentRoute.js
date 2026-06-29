const express = require('express');
const appointmentController = require('../controllers/appointmentController');
const validateMiddleware = require('../middleware/validateMiddleware');
const { protect, authorize } = require('../middleware/authMiddleware');
const {
    createAppointmentSchema,
    updateAppointmentSchema,
    listAppointmentsQuerySchema,
} = require('../validators/appointmentValidator');
const { USER_ROLES } = require('../config/constants');

const router = express.Router();

const appointmentAccessRoles = [
    USER_ROLES.CUSTOMER,
    USER_ROLES.STUDIO_ADMIN,
    USER_ROLES.STUDIO_STAFF,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
];

/**
 * @swagger
 * /appointments:
 *   post:
 *     summary: Book an appointment
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Books for a case. Group booking via gruppen_termin + gruppen_cases. Customer booking enforces lockout.
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [case_id, date, time]
 *             properties:
 *               case_id: { type: string }
 *               date: { type: string, format: date-time }
 *               time: { type: string, example: "10:00" }
 *               type: { type: string, enum: [beratung, treatment, first] }
 *               consultationOnly: { type: boolean }
 *               dauer_minuten: { type: number }
 *               standort_id: { type: string }
 *               standort_name: { type: string }
 *               gruppen_termin: { type: boolean }
 *               gruppen_cases: { type: array, items: { type: string } }
 *               gruppen_rabatt: { type: number }
 *               gruppen_preis_total: { type: number }
 *     responses:
 *       201:
 *         description: Appointment booked
 */
router.post(
    '/',
    protect,
    authorize(...appointmentAccessRoles),
    validateMiddleware(createAppointmentSchema),
    appointmentController.createAppointment
);

/**
 * @swagger
 * /appointments:
 *   get:
 *     summary: List appointments
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Scoped by role; supports date range and pagination filters.
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: case_id
 *         schema: { type: string }
 *       - in: query
 *         name: customer_id
 *         schema: { type: string }
 *       - in: query
 *         name: studio_id
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [gebucht, storniert, cancelled, completed] }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Paginated appointment list
 */
router.get(
    '/',
    protect,
    authorize(...appointmentAccessRoles),
    validateMiddleware(listAppointmentsQuerySchema, 'query'),
    appointmentController.listAppointments
);

/**
 * @swagger
 * /appointments/{id}:
 *   get:
 *     summary: Get appointment by ID
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Appointment details
 */
router.get(
    '/:id',
    protect,
    authorize(...appointmentAccessRoles),
    appointmentController.getAppointment
);

/**
 * @swagger
 * /appointments/{id}:
 *   patch:
 *     summary: Update or cancel appointment
 *     description: |
 *       **Auth:** Bearer · **Who can call:** customer, studio_admin, studio_staff, admin, super_admin
 *
 *       Reschedule (date/time) or cancel (status storniert/cancelled). Writes case activityLog.
 *     tags: [Appointments]
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
 *               date: { type: string, format: date-time }
 *               time: { type: string }
 *               status: { type: string, enum: [gebucht, storniert, cancelled, completed] }
 *     responses:
 *       200:
 *         description: Appointment updated
 */
router.patch(
    '/:id',
    protect,
    authorize(...appointmentAccessRoles),
    validateMiddleware(updateAppointmentSchema),
    appointmentController.updateAppointment
);

module.exports = router;

const express = require('express');
const authController = require('../controllers/authController');
const authRateLimiter = require('../middleware/authRateLimiter');
const validateMiddleware = require('../middleware/validateMiddleware');
const {
    registerCustomerSchema,
    registerStudioSchema,
    loginSchema,
} = require('../validators/authValidator');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * @swagger
 * /auth/register/customer:
 *   post:
 *     summary: Register a customer
 *     description: |
 *       **Auth:** None · **Who can call:** Anyone (public signup)
 *
 *       Customer selects studio via studio_code and creates a profile with doc field names (vorname, nachname, telefon, etc.).
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [vorname, nachname, email, telefon, password, studio_code]
 *             properties:
 *               vorname: { type: string }
 *               nachname: { type: string }
 *               email: { type: string, format: email }
 *               telefon: { type: string }
 *               password: { type: string, format: password }
 *               studio_code: { type: string }
 *               geburtsdatum: { type: string, format: date }
 *               strasse: { type: string }
 *               plz: { type: string }
 *               ort: { type: string }
 *               land: { type: string }
 *               akquise_quelle: { type: string, enum: [studio_eigen, plattform_vermittelt, studio_wechsel] }
 *     responses:
 *       201:
 *         description: Customer registered
 *       400:
 *         description: Validation error
 *       404:
 *         description: Studio not found
 */
router.post(
    '/register/customer',
    authRateLimiter,
    validateMiddleware(registerCustomerSchema),
    authController.registerCustomer
);

/**
 * @swagger
 * /auth/register/studio:
 *   post:
 *     summary: Register a studio
 *     description: |
 *       **Auth:** None · **Who can call:** Anyone (public application)
 *
 *       Studio applies for the platform. Account status is ausstehend until admin approval.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firma, studio_code, email, password]
 *             properties:
 *               firma: { type: string }
 *               studio_code: { type: string }
 *               email: { type: string, format: email }
 *               telefon: { type: string }
 *               password: { type: string, format: password }
 *               strasse: { type: string }
 *               plz: { type: string }
 *               ort: { type: string }
 *               land: { type: string }
 *               standorte: { type: array, items: { type: object } }
 *     responses:
 *       201:
 *         description: Studio registration submitted
 *       409:
 *         description: Email or studio_code already exists
 */
router.post(
    '/register/studio',
    authRateLimiter,
    validateMiddleware(registerStudioSchema),
    authController.registerStudio
);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Login
 *     description: |
 *       **Auth:** None · **Who can call:** Anyone
 *
 *       Shared login for customer, studio, and admin. Returns JWT access token and sets HttpOnly refresh cookie.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account locked or pending approval
 */
router.post('/login', authRateLimiter, validateMiddleware(loginSchema), authController.login);

/**
 * @swagger
 * /auth/refresh:
 *   post:
 *     summary: Refresh access token
 *     description: |
 *       **Auth:** HttpOnly refresh cookie · **Who can call:** Anyone with valid refresh cookie (set by login)
 *
 *       No Bearer token required. Uses cookie from POST /auth/login.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: New access token issued
 *       401:
 *         description: Invalid refresh token
 */
router.post('/refresh', authController.refresh);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Logout
 *     description: |
 *       **Auth:** HttpOnly refresh cookie (optional) · **Who can call:** Anyone
 *
 *       Revokes refresh token if cookie present.
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out
 */
router.post('/logout', authController.logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user profile
 *     description: |
 *       **Auth:** Bearer · **Who can call:** Any logged-in user (customer, studio, admin)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user and linked profile
 *       401:
 *         description: Not authorized
 *       403:
 *         description: Account locked or pending approval
 */
router.get('/me', protect, authController.getMe);

module.exports = router;

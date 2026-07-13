const express = require('express');
const { listPublicStudios } = require('../controllers/studioController');

const router = express.Router();

/**
 * @swagger
 * /studios/public:
 *   get:
 *     summary: List active studios for customer registration
 *     description: |
 *       **Auth:** None · **Who can call:** Anyone (public)
 *
 *       Returns only studios with status `aktiv`. Use `studio_code` from the chosen row
 *       in `POST /auth/register/customer`. Primary address fields are on the studio root;
 *       additional locations are in `standorte`.
 *     tags: [Studios]
 *     responses:
 *       200:
 *         description: Active studios sorted by firma
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     studios:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           studio_code: { type: string, example: INKFREE }
 *                           firma: { type: string }
 *                           strasse: { type: string }
 *                           plz: { type: string }
 *                           ort: { type: string }
 *                           land: { type: string }
 *                           standorte:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 name: { type: string }
 *                                 strasse: { type: string }
 *                                 plz: { type: string }
 *                                 ort: { type: string }
 *                                 land: { type: string }
 */
router.get('/public', listPublicStudios);

module.exports = router;

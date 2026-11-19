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
 *       Returns only studios with status `aktiv`. Each row includes Mongo `id` (for studio
 *       transfer `zu_firma_id`) and `studio_code` for `POST /auth/register/customer`.
 *       additional locations are in `standorte`.
 *
 *       Optional `q`: omitted → full active list (mobile). length &lt; 3 → empty array.
 *       length ≥ 3 → case-insensitive match on firma, studio_code, plz, ort, standorte.
 *     tags: [Studios]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string, minLength: 3 }
 *         required: false
 *         description: Text search (name / PLZ / city / code). Min 3 characters when set.
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
 *                           id: { type: string, description: MongoDB studio id (transfer picker) }
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

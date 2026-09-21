const express = require('express');
const { z } = require('zod');
const { protect, authorize } = require('../middleware/authMiddleware');
const validateMiddleware = require('../middleware/validateMiddleware');
const { USER_ROLES } = require('../config/constants');
const {
    DOCUMENT_CATEGORIES,
    DOCUMENT_SCOPES,
    DOCUMENT_VISIBILITY,
} = require('../models/platformDocumentModel');
const {
    listDocuments,
    getDocument,
    createDocument,
    updateDocument,
    toggleDocumentActive,
    deleteDocument,
} = require('../controllers/adminDocumentsController');

const router = express.Router();
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

const documentBodySchema = z.object({
    kategorie: z.enum(DOCUMENT_CATEGORIES),
    titel_de: z.string().trim().min(1).max(300),
    titel_en: z.string().trim().max(300).optional().default(''),
    inhalt_de: z.string().max(50000).optional().default(''),
    inhalt_en: z.string().max(50000).optional().default(''),
    geltungsbereich: z.enum(DOCUMENT_SCOPES).optional().default('global'),
    zugewiesene_studios: z.array(z.union([z.string(), z.object({ id: z.string() })])).optional(),
    sichtbar_in: z.array(z.enum(DOCUMENT_VISIBILITY)).optional().default([]),
    aktiv: z.boolean().optional().default(true),
});

const toggleSchema = z.object({
    aktiv: z.boolean().optional(),
});

router.get('/', protect, authorize(...adminRoles), listDocuments);
router.get('/:id', protect, authorize(...adminRoles), getDocument);
router.post(
    '/',
    protect,
    authorize(...adminRoles),
    validateMiddleware(documentBodySchema),
    createDocument
);
router.patch(
    '/:id',
    protect,
    authorize(...adminRoles),
    validateMiddleware(documentBodySchema),
    updateDocument
);
router.post(
    '/:id/toggle-active',
    protect,
    authorize(...adminRoles),
    validateMiddleware(toggleSchema),
    toggleDocumentActive
);
router.delete('/:id', protect, authorize(...adminRoles), deleteDocument);

module.exports = router;

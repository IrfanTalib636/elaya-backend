const { z } = require('zod');
const { SHOP_CATEGORIES } = require('../config/shopDefaults');
const { SHOP_ORDER_STATUS } = require('../config/constants');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const adminListProductsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    kategorie: z.enum(SHOP_CATEGORIES).optional(),
    aktiv: z.enum(['true', 'false']).optional(),
    q: z.string().optional(),
});

const adminProductCreateSchema = z.object({
    product_code: z.string().trim().min(1),
    artikelnummer: z.string().trim().min(1),
    name: z.string().trim().min(1),
    beschreibung: z.string().trim().optional().default(''),
    preis_chf: z.coerce.number().min(0),
    kategorie: z.enum(SHOP_CATEGORIES).default('Sonstiges'),
    ean: z.string().trim().optional().default(''),
    ursprung: z.string().trim().optional().default(''),
    bild_url: z.string().trim().optional().default(''),
    lagerbestand: z.coerce.number().int().min(0).nullable().optional(),
    aktiv: z.boolean().optional().default(true),
    sort_order: z.coerce.number().int().optional().default(0),
});

const adminProductUpdateSchema = adminProductCreateSchema.partial();

const adminListOrdersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    studio_id: objectId.optional(),
    status: z.enum(Object.values(SHOP_ORDER_STATUS)).optional(),
    commission_status: z.enum(['pending', 'paid', 'cancelled']).optional(),
});

const patchCommissionSchema = z.object({
    commission_status: z.enum(['pending', 'paid', 'cancelled']),
});

module.exports = {
    adminListProductsQuerySchema,
    adminProductCreateSchema,
    adminProductUpdateSchema,
    adminListOrdersQuerySchema,
    patchCommissionSchema,
};

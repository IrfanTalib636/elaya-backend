const { z } = require('zod');
const { SHOP_CURRENCIES } = require('../config/shopDefaults');
const { SHOP_ORDER_STATUS } = require('../config/constants');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const adminListProductsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    kategorie: z.string().trim().min(1).max(80).optional(),
    aktiv: z.enum(['true', 'false']).optional(),
    q: z.string().optional(),
});

/** Coerces '', null → null; numeric-ish strings → Date. Used for optional discount dates. */
const optionalDate = z
    .union([z.string(), z.date(), z.null()])
    .optional()
    .transform((v) => {
        if (v === '' || v === null || v === undefined) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    });

const productDiscountSchema = z
    .object({
        aktiv: z.boolean().optional().default(false),
        typ: z.enum(['percent', 'fixed']).optional().default('percent'),
        wert: z.coerce.number().min(0).optional().default(0),
        von: optionalDate,
        bis: optionalDate,
        stackable_with_general: z.boolean().optional().default(false),
        exclude_from_general: z.boolean().optional().default(false),
    })
    .optional();

const adminProductCreateSchema = z.object({
    product_code: z.string().trim().min(1),
    artikelnummer: z.string().trim().min(1),
    name: z.string().trim().min(1),
    beschreibung: z.string().trim().optional().default(''),
    preis_chf: z.coerce.number().min(0),
    waehrung: z.enum(SHOP_CURRENCIES).optional().default('CHF'),
    kategorie: z.string().trim().min(1).max(80).default('Sonstiges'),
    ean: z.string().trim().optional().default(''),
    ursprung: z.string().trim().optional().default(''),
    bild_url: z.string().trim().optional().default(''),
    bilder: z.array(z.string().trim().min(1)).optional().default([]),
    lagerbestand: z.coerce.number().int().min(0).nullable().optional(),
    aktiv: z.boolean().optional().default(true),
    sort_order: z.coerce.number().int().optional().default(0),
    rabatt: productDiscountSchema,
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

// ── Promotions (platform-wide general discount) ───────────────────────────

const adminListPromotionsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    aktiv: z.enum(['true', 'false']).optional(),
});

const adminPromotionCreateSchema = z.object({
    name: z.string().trim().min(1),
    aktiv: z.boolean().optional().default(true),
    typ: z.enum(['percent', 'fixed']).optional().default('percent'),
    wert: z.coerce.number().min(0),
    waehrung: z.enum(SHOP_CURRENCIES).optional().default('CHF'),
    von: optionalDate,
    bis: optionalDate,
    exclude_product_ids: z.array(objectId).optional().default([]),
});

const adminPromotionUpdateSchema = adminPromotionCreateSchema.partial();

module.exports = {
    adminListProductsQuerySchema,
    adminProductCreateSchema,
    adminProductUpdateSchema,
    adminListOrdersQuerySchema,
    patchCommissionSchema,
    adminListPromotionsQuerySchema,
    adminPromotionCreateSchema,
    adminPromotionUpdateSchema,
};

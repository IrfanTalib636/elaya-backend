const { z } = require('zod');
const { SHOP_ORDER_STATUS } = require('../config/constants');
const { SHOP_CATEGORIES, SHOP_COUNTRIES } = require('../config/shopDefaults');

const listShopOrdersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    status: z.enum(Object.values(SHOP_ORDER_STATUS)).optional(),
    studio_id: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

const patchShopOrderStatusSchema = z.object({
    status: z.enum(Object.values(SHOP_ORDER_STATUS)),
});

const analyticsQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    studio_id: z.string().regex(/^[a-f\d]{24}$/i).optional(),
});

const listProductsQuerySchema = z.object({
    kategorie: z.enum(SHOP_CATEGORIES).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

const createShopOrderSchema = z.object({
    items: z
        .array(
            z.object({
                produkt_id: z.string().trim().min(1),
                menge: z.coerce.number().int().min(1).max(99),
            })
        )
        .min(1, 'At least one item is required'),
    lieferadresse: z.object({
        vorname: z.string().trim().min(1),
        nachname: z.string().trim().min(1),
        strasse: z.string().trim().min(1),
        plz: z.string().trim().min(1),
        ort: z.string().trim().min(1),
        land: z.enum(SHOP_COUNTRIES).default('Schweiz'),
    }),
    zahlungsart: z.enum(['karte', 'twint']).default('karte'),
});

const shippingQuoteSchema = z.object({
    land: z.enum(SHOP_COUNTRIES).default('Schweiz'),
    warenwert: z.coerce.number().min(0).optional().default(0),
});

module.exports = {
    listShopOrdersQuerySchema,
    patchShopOrderStatusSchema,
    analyticsQuerySchema,
    listProductsQuerySchema,
    createShopOrderSchema,
    shippingQuoteSchema,
};

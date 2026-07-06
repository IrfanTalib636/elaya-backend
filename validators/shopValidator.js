const { z } = require('zod');
const { SHOP_ORDER_STATUS } = require('../config/constants');

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

module.exports = {
    listShopOrdersQuerySchema,
    patchShopOrderStatusSchema,
    analyticsQuerySchema,
};

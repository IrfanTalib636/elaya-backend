const { z } = require('zod');
const { ACTIVITY_CATEGORIES } = require('../config/activityConfig');

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const listActivityQuerySchema = z.object({
    customer_id: objectId.optional(),
    category: z.enum(['all', ...ACTIVITY_CATEGORIES]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    studio_id: objectId.optional(),
});

module.exports = { listActivityQuerySchema };

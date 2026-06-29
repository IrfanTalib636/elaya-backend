const { z } = require('zod');
const { MAX_LIMIT } = require('../utils/pagination');

const paginationQueryFields = {
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional().default(20),
};

module.exports = { paginationQueryFields };

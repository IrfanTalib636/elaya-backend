const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const parsePagination = (query = {}) => {
    const page = Math.max(1, Number.parseInt(query.page, 10) || DEFAULT_PAGE);
    const limit = Math.min(
        MAX_LIMIT,
        Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT)
    );
    const skip = (page - 1) * limit;

    return { page, limit, skip };
};

const buildPaginationMeta = (page, limit, total) => {
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1 && totalPages > 0,
    };
};

module.exports = {
    MAX_LIMIT,
    parsePagination,
    buildPaginationMeta,
};

const asyncHandler = require('../utils/asyncHandler');
const { listPlatformAuditLogs } = require('../services/platformAuditService');

const listAuditLogs = asyncHandler(async (req, res) => {
    const data = await listPlatformAuditLogs({
        action: req.query.action,
        date: req.query.date,
        page: req.query.page,
        limit: req.query.limit,
    });
    res.json({ success: true, data });
});

module.exports = {
    listAuditLogs,
};

const asyncHandler = require('../utils/asyncHandler');
const { resolveStudioId } = require('../utils/studioScope');
const { listOpenActions } = require('../utils/openActionService');

const listStudioOpenActions = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const data = await listOpenActions({
        studioId,
        notify: true,
        type: req.query.type || null,
        priority: req.query.priority || null,
        minAgeHours: req.query.min_age_hours,
    });
    res.status(200).json({ success: true, data });
});

const studioOpenActionSummary = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const data = await listOpenActions({ studioId, notify: true });
    res.status(200).json({
        success: true,
        data: {
            open: data.summary.open,
            urgent: data.summary.urgent,
        },
    });
});

const listAdminOpenActions = asyncHandler(async (req, res) => {
    const data = await listOpenActions({
        studioId: req.query.studio_id || null,
        notify: false,
        type: req.query.type || null,
        priority: req.query.priority || null,
        minAgeHours: req.query.min_age_hours,
    });
    res.status(200).json({ success: true, data });
});

const adminOpenActionSummary = asyncHandler(async (req, res) => {
    const data = await listOpenActions({ notify: false });
    res.status(200).json({
        success: true,
        data: {
            open: data.summary.open,
            urgent: data.summary.urgent,
        },
    });
});

module.exports = {
    listStudioOpenActions,
    studioOpenActionSummary,
    listAdminOpenActions,
    adminOpenActionSummary,
};

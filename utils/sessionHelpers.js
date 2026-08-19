const mongoose = require('mongoose');
const Session = require('../models/sessionModel');
const Case = require('../models/caseModel');
const { CASE_STATUS } = require('../config/constants');

const getNextSessionNumber = async (caseId) => {
    const latest = await Session.findOne({ case: caseId })
        .sort({ session_number: -1 })
        .select('session_number')
        .lean();

    return (latest?.session_number ?? 0) + 1;
};

const syncCaseSessionStats = async (caseId) => {
    const [stats] = await Session.aggregate([
        {
            $match: {
                case: new mongoose.Types.ObjectId(caseId),
                is_draft: false,
                is_no_show: false,
            },
        },
        {
            $addFields: {
                fading_pct: {
                    $cond: [
                        { $eq: ['$comparison_eligible', false] },
                        0,
                        {
                            $max: [
                                { $ifNull: ['$removal_pct', 0] },
                                { $ifNull: ['$verblassung_prozent', 0] },
                            ],
                        },
                    ],
                },
            },
        },
        {
            $group: {
                _id: null,
                sessionsDone: { $sum: 1 },
                lastSessionDate: { $max: '$treatment_date' },
                removal: { $max: '$fading_pct' },
            },
        },
    ]);

    // Flow_Mapping session_completed: lastSessionDate is the healing baseline
    // for the next aftercare window (days since last treatment).
    const update = {
        sessionsDone: stats?.sessionsDone ?? 0,
        lastSessionDate: stats?.lastSessionDate ?? null,
    };

    if (stats?.removal != null && stats.removal > 0) {
        update.removal = stats.removal;
    }

    if (update.sessionsDone > 0) {
        update.status = CASE_STATUS.ACTIVE;
    }

    await Case.updateOne({ _id: caseId }, update);
};

module.exports = {
    getNextSessionNumber,
    syncCaseSessionStats,
};

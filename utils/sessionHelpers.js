const mongoose = require('mongoose');
const Session = require('../models/sessionModel');
const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const { CASE_STATUS } = require('../config/constants');

/**
 * Next session number, counted within the zone when one is given. Each zone of a
 * multi-zone tattoo is treated independently, so both can have a session 1.
 */
const getNextSessionNumber = async (caseId, zonenId = null) => {
    const latest = await Session.findOne({ case: caseId, zonen_id: zonenId ?? null })
        .sort({ session_number: -1 })
        .select('session_number')
        .lean();

    return (latest?.session_number ?? 0) + 1;
};

/** Fading percentage of a session, treating non-comparable ones as no progress. */
const FADING_PCT_FIELD = {
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
};

/**
 * Roll the per-zone session stats up onto the zone rows, so each zone card can
 * show its own real progress instead of a placeholder zero.
 */
const syncZoneSessionStats = async (caseId) => {
    const rows = await Session.aggregate([
        {
            $match: {
                case: new mongoose.Types.ObjectId(caseId),
                is_draft: false,
                is_no_show: false,
                zonen_id: { $ne: null },
            },
        },
        { $addFields: { fading_pct: FADING_PCT_FIELD } },
        {
            $group: {
                _id: '$zonen_id',
                sessionsDone: { $sum: 1 },
                lastSessionDate: { $max: '$treatment_date' },
                fortschritt: { $max: '$fading_pct' },
            },
        },
    ]);

    if (!rows.length) return;

    await Promise.all(
        rows.map((row) =>
            CaseZone.updateOne(
                { case: caseId, zonen_id: row._id },
                {
                    $set: {
                        fortschritt_prozent: Math.round(row.fortschritt ?? 0),
                        sitzungen_erledigt: row.sessionsDone,
                        letzte_sitzung: row.lastSessionDate ?? null,
                    },
                }
            )
        )
    );
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
        { $addFields: { fading_pct: FADING_PCT_FIELD } },
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
    await syncZoneSessionStats(caseId);
};

module.exports = {
    getNextSessionNumber,
    syncCaseSessionStats,
    syncZoneSessionStats,
};

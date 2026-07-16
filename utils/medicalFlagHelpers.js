const Case = require('../models/caseModel');

const AMPEL_RANK = { rot: 3, orange: 2, gruen: 1 };
const RANK_AMPEL = { 3: 'rot', 2: 'orange', 1: 'gruen' };

const WORST_FLAG_SWITCH = {
    $max: {
        $switch: {
            branches: [
                { case: { $eq: ['$medical_flag_level', 'rot'] }, then: 3 },
                { case: { $eq: ['$medical_flag_level', 'orange'] }, then: 2 },
                { case: { $eq: ['$medical_flag_level', 'gruen'] }, then: 1 },
            ],
            default: 0,
        },
    },
};

const worstMedicalFlagLevel = (levels = []) => {
    let worst = 0;
    for (const level of levels) {
        const rank = AMPEL_RANK[level] || 0;
        if (rank > worst) worst = rank;
    }
    return worst ? RANK_AMPEL[worst] : null;
};

/**
 * Aggregate worst medical ampel + open flag counts per customer.
 * @returns {Record<string, { worst_medical_flag_level: string|null, open_medical_flags_count: number, pending_anamnesis_count: number }>}
 */
const aggregateMedicalFlagsByCustomer = async (customerIds) => {
    if (!customerIds?.length) return {};

    const rows = await Case.aggregate([
        { $match: { customer: { $in: customerIds } } },
        {
            $group: {
                _id: '$customer',
                worst: WORST_FLAG_SWITCH,
                open_flags: { $sum: { $ifNull: ['$open_medical_flags_count', 0] } },
                pending_anamnesis: {
                    $sum: { $cond: [{ $eq: ['$anamnesis_complete', true] }, 0, 1] },
                },
            },
        },
    ]);

    return Object.fromEntries(
        rows.map((row) => [
            row._id.toString(),
            {
                worst_medical_flag_level: RANK_AMPEL[row.worst] || null,
                open_medical_flags_count: row.open_flags || 0,
                pending_anamnesis_count: row.pending_anamnesis || 0,
            },
        ])
    );
};

module.exports = {
    worstMedicalFlagLevel,
    aggregateMedicalFlagsByCustomer,
};

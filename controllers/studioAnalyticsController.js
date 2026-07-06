const mongoose = require('mongoose');
const Session = require('../models/sessionModel');
const Customer = require('../models/customerModel');
const ShopOrder = require('../models/shopOrderModel');
const Appointment = require('../models/appointmentModel');
const asyncHandler = require('../utils/asyncHandler');
const { resolveStudioId } = require('../utils/studioScope');
const { AKQUISE_QUELLE, APPOINTMENT_STATUS } = require('../config/constants');
const { getPlatformConfig } = require('../utils/configService');
const { DEFAULT_SHOP_PROVISION_PROZENT } = require('../config/shopDefaults');
const { PIPELINE_ORDER } = require('../utils/pipelineEngine');

const MONTHS_DE = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const buildDateFilter = (from, to) => {
    const filter = {};
    if (from) filter.$gte = new Date(from);
    if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.$lte = end;
    }
    return Object.keys(filter).length ? filter : null;
};

const buildChartMonthBuckets = () => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
        const start = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
        return {
            year: start.getFullYear(),
            month: start.getMonth() + 1,
            label: MONTHS_DE[start.getMonth()],
            from: start,
            to: end,
        };
    });
};

const emptyByAkquise = () => ({
    [AKQUISE_QUELLE.STUDIO_EIGEN]: { umsatz: 0, count: 0 },
    [AKQUISE_QUELLE.PLATTFORM_VERMITTELT]: { umsatz: 0, count: 0 },
    [AKQUISE_QUELLE.STUDIO_WECHSEL]: { umsatz: 0, count: 0 },
});

/** Mongo filters shared across aggregation queries. */
const buildAnalyticsFilters = (studioOid, dateFilter) => {
    const sessionFilter = {
        studio: studioOid,
        is_draft: false,
        is_no_show: false,
    };
    if (dateFilter) sessionFilter.treatment_date = dateFilter;

    const noShowFilter = {
        studio: studioOid,
        is_draft: false,
        is_no_show: true,
    };
    if (dateFilter) noShowFilter.treatment_date = dateFilter;

    const shopFilter = { studio: studioOid };
    if (dateFilter) shopFilter.createdAt = dateFilter;

    const apptFilter = { studio: studioOid };
    if (dateFilter) apptFilter.date = dateFilter;

    const coinRewardMatch = {
        'elaycoins.transactions.typ': 'reward',
        'elaycoins.transactions.coins': { $gt: 0 },
    };
    if (dateFilter) {
        coinRewardMatch['elaycoins.transactions.datum'] = dateFilter;
    }

    return { sessionFilter, noShowFilter, shopFilter, apptFilter, coinRewardMatch };
};

const sessionTreatmentFacetPipeline = (sessionFilter) => [
    { $match: sessionFilter },
    {
        $lookup: {
            from: 'customers',
            localField: 'customer',
            foreignField: '_id',
            as: 'cust',
            pipeline: [{ $project: { vorname: 1, nachname: 1, akquise_quelle: 1 } }],
        },
    },
    { $unwind: { path: '$cust', preserveNullAndEmptyArrays: true } },
    {
        $facet: {
            byAkquise: [
                {
                    $group: {
                        _id: { $ifNull: ['$cust.akquise_quelle', AKQUISE_QUELLE.STUDIO_EIGEN] },
                        umsatz: { $sum: { $ifNull: ['$zahlung.betragCHF', 0] } },
                        count: { $sum: 1 },
                    },
                },
            ],
            topCustomers: [
                {
                    $group: {
                        _id: '$customer',
                        name: {
                            $first: {
                                $trim: {
                                    input: {
                                        $concat: [
                                            { $ifNull: ['$cust.vorname', ''] },
                                            ' ',
                                            { $ifNull: ['$cust.nachname', ''] },
                                        ],
                                    },
                                },
                            },
                        },
                        akquise_quelle: {
                            $first: { $ifNull: ['$cust.akquise_quelle', AKQUISE_QUELLE.STUDIO_EIGEN] },
                        },
                        umsatz: { $sum: { $ifNull: ['$zahlung.betragCHF', 0] } },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { umsatz: -1 } },
                { $limit: 10 },
            ],
            totals: [
                {
                    $group: {
                        _id: null,
                        revenue: { $sum: { $ifNull: ['$zahlung.betragCHF', 0] } },
                        count: { $sum: 1 },
                    },
                },
            ],
        },
    },
];

const shopStatsPipeline = (shopFilter, shopProvisionPercent) => [
    { $match: shopFilter },
    {
        $group: {
            _id: null,
            order_count: { $sum: 1 },
            revenue: { $sum: { $ifNull: ['$total_chf', 0] } },
            provision_total: {
                $sum: {
                    $cond: [
                        { $gt: [{ $ifNull: ['$provision_betrag', 0] }, 0] },
                        '$provision_betrag',
                        {
                            $multiply: [
                                { $ifNull: ['$total_chf', 0] },
                                { $divide: [shopProvisionPercent, 100] },
                            ],
                        },
                    ],
                },
            },
        },
    },
];

const coinBalancePipeline = (studioOid) => [
    { $match: { aktuelle_firma_id: studioOid } },
    {
        $group: {
            _id: null,
            total_balance: { $sum: { $ifNull: ['$elaycoins.balance', 0] } },
            with_balance: {
                $sum: {
                    $cond: [{ $gt: [{ $ifNull: ['$elaycoins.balance', 0] }, 0] }, 1, 0],
                },
            },
        },
    },
];

const coinRewardsInPeriodPipeline = (studioOid, coinRewardMatch) => [
    { $match: { aktuelle_firma_id: studioOid } },
    { $unwind: '$elaycoins.transactions' },
    { $match: coinRewardMatch },
    { $group: { _id: null, total: { $sum: '$elaycoins.transactions.coins' } } },
];

const pipelineCountsPipeline = (studioOid) => [
    { $match: { aktuelle_firma_id: studioOid } },
    { $group: { _id: '$pipeline_stufe', count: { $sum: 1 } } },
];

const monthlyRevenuePipeline = (studioOid, chartFrom) => [
    {
        $match: {
            studio: studioOid,
            is_draft: false,
            is_no_show: false,
            treatment_date: { $gte: chartFrom },
        },
    },
    {
        $group: {
            _id: {
                year: { $year: '$treatment_date' },
                month: { $month: '$treatment_date' },
            },
            revenue: { $sum: { $ifNull: ['$zahlung.betragCHF', 0] } },
        },
    },
];

/** Run all analytics queries in parallel. */
const fetchAnalyticsData = async (studioOid, filters, shopProvisionPercent, chartFrom) => {
    const { sessionFilter, noShowFilter, shopFilter, apptFilter, coinRewardMatch } = filters;

    const [
        sessionFacet,
        noShowCount,
        shopAgg,
        coinBalanceAgg,
        coinRewardAgg,
        pipelineAgg,
        apptTotal,
        apptCancelled,
        totalCustomers,
        monthlyRevenueAgg,
    ] = await Promise.all([
        Session.aggregate(sessionTreatmentFacetPipeline(sessionFilter)),
        Session.countDocuments(noShowFilter),
        ShopOrder.aggregate(shopStatsPipeline(shopFilter, shopProvisionPercent)),
        Customer.aggregate(coinBalancePipeline(studioOid)),
        Customer.aggregate(coinRewardsInPeriodPipeline(studioOid, coinRewardMatch)),
        Customer.aggregate(pipelineCountsPipeline(studioOid)),
        Appointment.countDocuments(apptFilter),
        Appointment.countDocuments({ ...apptFilter, status: APPOINTMENT_STATUS.STORNIERT }),
        Customer.countDocuments({ aktuelle_firma_id: studioOid }),
        Session.aggregate(monthlyRevenuePipeline(studioOid, chartFrom)),
    ]);

    return {
        sessionFacet,
        noShowCount,
        shopAgg,
        coinBalanceAgg,
        coinRewardAgg,
        pipelineAgg,
        apptTotal,
        apptCancelled,
        totalCustomers,
        monthlyRevenueAgg,
    };
};

const mapSessionFacet = (sessionFacet) => {
    const facet = sessionFacet[0] ?? { byAkquise: [], topCustomers: [], totals: [] };

    const byAkquise = emptyByAkquise();
    (facet.byAkquise ?? []).forEach((row) => {
        if (byAkquise[row._id]) {
            byAkquise[row._id].umsatz = row.umsatz;
            byAkquise[row._id].count = row.count;
        }
    });

    const totals = facet.totals?.[0] ?? { revenue: 0, count: 0 };
    const topCustomers = (facet.topCustomers ?? []).map((row) => ({
        customer_id: row._id?.toString(),
        name: row.name,
        akquise_quelle: row.akquise_quelle,
        umsatz: row.umsatz,
        count: row.count,
    }));

    return { byAkquise, totals, topCustomers };
};

const mapPipelineCounts = (pipelineAgg) => {
    const pipelineCounts = Object.fromEntries(PIPELINE_ORDER.map((stage) => [stage, 0]));
    pipelineAgg.forEach((row) => {
        const key = PIPELINE_ORDER.includes(row._id) ? row._id : PIPELINE_ORDER[0];
        pipelineCounts[key] = (pipelineCounts[key] ?? 0) + row.count;
    });
    return pipelineCounts;
};

const mapChartMonths = (chartBuckets, monthlyRevenueAgg) => {
    const revenueByMonth = Object.fromEntries(
        monthlyRevenueAgg.map((row) => [`${row._id.year}-${row._id.month}`, row.revenue])
    );
    return chartBuckets.map((bucket) => ({
        label: bucket.label,
        revenue: revenueByMonth[`${bucket.year}-${bucket.month}`] ?? 0,
    }));
};

/** Shape raw DB results into the API response payload. */
const buildSummaryResponse = (raw, { from, to, feePercent, shopProvisionPercent, chartBuckets }) => {
    const { byAkquise, totals, topCustomers } = mapSessionFacet(raw.sessionFacet);
    const treatmentRevenue = totals.revenue ?? 0;
    const feeBase =
        byAkquise[AKQUISE_QUELLE.PLATTFORM_VERMITTELT].umsatz +
        byAkquise[AKQUISE_QUELLE.STUDIO_WECHSEL].umsatz;
    const platformFee = feeBase * (feePercent / 100);

    const shopStats = raw.shopAgg[0] ?? { order_count: 0, revenue: 0, provision_total: 0 };
    const coinBalance = raw.coinBalanceAgg[0] ?? { total_balance: 0, with_balance: 0 };
    const shopProvision = shopStats.provision_total ?? 0;

    return {
        period: { from: from ?? null, to: to ?? null },
        treatment: {
            revenue: treatmentRevenue,
            session_count: totals.count ?? 0,
            by_akquise: byAkquise,
            top_customers: topCustomers,
        },
        platform_fee: {
            percent: feePercent,
            amount: platformFee,
            base_revenue: feeBase,
        },
        shop: {
            order_count: shopStats.order_count ?? 0,
            revenue: shopStats.revenue ?? 0,
            provision_percent: shopProvisionPercent,
            provision_total: shopProvision,
        },
        coins: {
            total_balance: coinBalance.total_balance ?? 0,
            customers_with_balance: coinBalance.with_balance ?? 0,
            rewarded_in_period: raw.coinRewardAgg[0]?.total ?? 0,
        },
        dashboard: {
            no_show_count: raw.noShowCount,
            pipeline_counts: mapPipelineCounts(raw.pipelineAgg),
            total_customers: raw.totalCustomers,
            appointments: {
                total: raw.apptTotal,
                cancelled: raw.apptCancelled,
            },
        },
        chart_months: mapChartMonths(chartBuckets, raw.monthlyRevenueAgg),
        netto_approx: treatmentRevenue - platformFee + shopProvision,
    };
};

/** GET /studio/analytics/summary */
const getStudioAnalyticsSummary = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const studioOid = new mongoose.Types.ObjectId(studioId);
    const { from, to } = req.query;

    const platformConfig = await getPlatformConfig();
    const feePercent = platformConfig.transaktionsProzent ?? 3;
    const shopProvisionPercent = DEFAULT_SHOP_PROVISION_PROZENT;

    const dateFilter = buildDateFilter(from, to);
    const filters = buildAnalyticsFilters(studioOid, dateFilter);
    const chartBuckets = buildChartMonthBuckets();
    const chartFrom = chartBuckets[0].from;

    const raw = await fetchAnalyticsData(studioOid, filters, shopProvisionPercent, chartFrom);
    const data = buildSummaryResponse(raw, { from, to, feePercent, shopProvisionPercent, chartBuckets });

    res.json({ success: true, data });
});

module.exports = { getStudioAnalyticsSummary };

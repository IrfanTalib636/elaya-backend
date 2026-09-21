const mongoose = require('mongoose');
const Studio = require('../models/studioModel');
const Customer = require('../models/customerModel');
const Session = require('../models/sessionModel');
const ShopOrder = require('../models/shopOrderModel');
const { getPlatformConfig } = require('./configService');
const {
    SUBSCRIPTION_PACKAGES,
    resolveStudioFinanceTerms,
    PACKAGE_TO_PLAN,
    hasOverrideValue,
} = require('../config/subscriptionPackages');
const { STUDIO_STATUS } = require('../config/constants');
const ApiError = require('./ApiError');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const currentMonthRange = (ref = new Date()) => {
    const from = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from, to };
};

/**
 * Platform Finanzen overview — Reines Abo-Modell:
 * recurring abo + Elaya shop share (current month). No transaction fee.
 */
async function getPlatformFinanceOverview() {
    const platform = await getPlatformConfig();
    const { from, to } = currentMonthRange();
    const studios = await Studio.find({})
        .select(
            'firma studio_code status subscription_plan standorte preis_override shop_provision_override override_grund override_datum'
        )
        .lean();

    const studioIds = studios.map((s) => s._id);

    const [customerCounts, shopByStudio, sessionByStudio] = await Promise.all([
        Customer.aggregate([
            { $match: { aktuelle_firma_id: { $in: studioIds } } },
            { $group: { _id: '$aktuelle_firma_id', count: { $sum: 1 } } },
        ]),
        ShopOrder.aggregate([
            {
                $match: {
                    studio: { $in: studioIds },
                    createdAt: { $gte: from, $lte: to },
                },
            },
            {
                $group: {
                    _id: '$studio',
                    order_count: { $sum: 1 },
                    revenue: { $sum: '$total_chf' },
                    provision_total: { $sum: { $ifNull: ['$provision_betrag', 0] } },
                    elaya_total: { $sum: { $ifNull: ['$elaya_anteil_chf', 0] } },
                    pending_provision: {
                        $sum: {
                            $cond: [
                                { $eq: ['$commission_status', 'pending'] },
                                { $ifNull: ['$provision_betrag', 0] },
                                0,
                            ],
                        },
                    },
                    paid_provision: {
                        $sum: {
                            $cond: [
                                { $eq: ['$commission_status', 'paid'] },
                                { $ifNull: ['$provision_betrag', 0] },
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
        Session.aggregate([
            {
                $match: {
                    studio: { $in: studioIds },
                    is_draft: { $ne: true },
                    is_no_show: { $ne: true },
                    treatment_date: { $gte: from, $lte: to },
                },
            },
            {
                $group: {
                    _id: '$studio',
                    session_revenue: {
                        $sum: {
                            $ifNull: ['$zahlung.betragCHF', { $ifNull: ['$zahlung.betrag', 0] }],
                        },
                    },
                },
            },
        ]),
    ]);

    const custMap = Object.fromEntries(
        customerCounts.map((r) => [String(r._id), r.count])
    );
    const shopMap = Object.fromEntries(
        shopByStudio.map((r) => [String(r._id), r])
    );
    const sessMap = Object.fromEntries(
        sessionByStudio.map((r) => [String(r._id), r])
    );

    const package_counts = { starter: 0, pro: 0, network: 0 };
    let aboSumme = 0;
    let shopElayaSumme = 0;
    let shopGmvSumme = 0;
    let provisionSumme = 0;
    let pendingSumme = 0;
    let paidSumme = 0;

    const rows = studios.map((s) => {
        const terms = resolveStudioFinanceTerms(s, platform.shop_provision_prozent);
        const sid = String(s._id);
        const shop = shopMap[sid] || {};
        const sess = sessMap[sid] || {};
        package_counts[terms.package_id] = (package_counts[terms.package_id] || 0) + 1;
        aboSumme += terms.abo_chf;
        const elayaShop = round2(shop.elaya_total || 0);
        shopElayaSumme += elayaShop;
        shopGmvSumme += round2(shop.revenue || 0);
        provisionSumme += round2(shop.provision_total || 0);
        pendingSumme += round2(shop.pending_provision || 0);
        paidSumme += round2(shop.paid_provision || 0);

        return {
            studio_id: s._id,
            studio_name: s.firma || '',
            studio_code: s.studio_code || '',
            status: s.status || STUDIO_STATUS.AUSSTEHEND,
            package_id: terms.package_id,
            package_name: terms.package_name,
            subscription_plan: terms.subscription_plan,
            standorte_count: Array.isArray(s.standorte) ? s.standorte.length : 0,
            customers_count: custMap[sid] || 0,
            abo_chf: terms.abo_chf,
            shop_provision_studio_prozent: terms.shop_provision_studio_prozent,
            has_override: terms.has_override,
            shop_revenue: round2(shop.revenue || 0),
            shop_elaya_chf: elayaShop,
            shop_provision_chf: round2(shop.provision_total || 0),
            pending_provision: round2(shop.pending_provision || 0),
            paid_provision: round2(shop.paid_provision || 0),
            order_count: shop.order_count || 0,
            session_revenue: round2(sess.session_revenue || 0),
            open_invoices_count: 0,
            open_invoices_chf: 0,
        };
    });

    rows.sort((a, b) => String(a.studio_name).localeCompare(String(b.studio_name)));

    return {
        model: 'abo',
        currency: 'CHF',
        vat_excluded: true,
        period: {
            from: from.toISOString(),
            to: to.toISOString(),
            label: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`,
        },
        packages: SUBSCRIPTION_PACKAGES,
        package_counts,
        provision_percent_default: platform.shop_provision_prozent ?? 20,
        stripe_connect_enabled: Boolean(
            process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim()
        ),
        totals: {
            abo_recurring_chf: round2(aboSumme),
            shop_elaya_chf: round2(shopElayaSumme),
            total_elaya_chf: round2(aboSumme + shopElayaSumme),
            open_invoices_count: 0,
            open_invoices_chf: 0,
            // Shop commission ledger (kept for ops / existing UI)
            shop_gmv_chf: round2(shopGmvSumme),
            provision_total: round2(provisionSumme),
            pending_provision: round2(pendingSumme),
            paid_provision: round2(paidSumme),
        },
        studios: rows,
        rules: {
            erloes:
                'Abo fee per studio + Elaya share of shop revenue. No transaction fee.',
            akquise: 'Acquisition source is analysis-only and does not affect fees.',
            currency: 'All amounts CHF, excl. VAT.',
        },
    };
}

/**
 * Studio finance detail — dual P&L (Studio vs Elaya) for current month + shop products.
 */
async function getStudioFinanceDetail(studioId) {
    if (!mongoose.Types.ObjectId.isValid(studioId)) {
        throw new ApiError(400, 'Invalid studio id');
    }
    const platform = await getPlatformConfig();
    const studio = await Studio.findById(studioId)
        .select(
            'firma studio_code status subscription_plan standorte preis_override shop_provision_override override_grund override_datum feature_overrides'
        )
        .lean();
    if (!studio) throw new ApiError(404, 'Studio not found');

    const terms = resolveStudioFinanceTerms(studio, platform.shop_provision_prozent);
    const { from, to } = currentMonthRange();

    const [customers, shopAgg, sessionAgg, products, akquise] = await Promise.all([
        Customer.countDocuments({ aktuelle_firma_id: studioId }),
        ShopOrder.aggregate([
            {
                $match: {
                    studio: new mongoose.Types.ObjectId(studioId),
                    createdAt: { $gte: from, $lte: to },
                },
            },
            {
                $group: {
                    _id: null,
                    order_count: { $sum: 1 },
                    revenue: { $sum: '$total_chf' },
                    provision_total: { $sum: { $ifNull: ['$provision_betrag', 0] } },
                    elaya_total: { $sum: { $ifNull: ['$elaya_anteil_chf', 0] } },
                    pending_provision: {
                        $sum: {
                            $cond: [
                                { $eq: ['$commission_status', 'pending'] },
                                { $ifNull: ['$provision_betrag', 0] },
                                0,
                            ],
                        },
                    },
                    paid_provision: {
                        $sum: {
                            $cond: [
                                { $eq: ['$commission_status', 'paid'] },
                                { $ifNull: ['$provision_betrag', 0] },
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
        Session.aggregate([
            {
                $match: {
                    studio: new mongoose.Types.ObjectId(studioId),
                    is_draft: { $ne: true },
                    is_no_show: { $ne: true },
                    treatment_date: { $gte: from, $lte: to },
                },
            },
            {
                $group: {
                    _id: null,
                    session_revenue: {
                        $sum: {
                            $ifNull: ['$zahlung.betragCHF', { $ifNull: ['$zahlung.betrag', 0] }],
                        },
                    },
                    session_count: { $sum: 1 },
                },
            },
        ]),
        ShopOrder.aggregate([
            {
                $match: {
                    studio: new mongoose.Types.ObjectId(studioId),
                    createdAt: { $gte: from, $lte: to },
                },
            },
            { $unwind: '$produkte' },
            {
                $group: {
                    _id: {
                        product_id: '$produkte.produkt_id',
                        name: '$produkte.produkt_name',
                    },
                    quantity: { $sum: { $ifNull: ['$produkte.menge', 0] } },
                    order_ids: { $addToSet: '$_id' },
                    revenue: {
                        $sum: {
                            $multiply: [
                                { $ifNull: ['$produkte.menge', 0] },
                                { $ifNull: ['$produkte.preis_chf', 0] },
                            ],
                        },
                    },
                    commission: {
                        $sum: {
                            $multiply: [
                                { $ifNull: ['$produkte.menge', 0] },
                                { $ifNull: ['$produkte.preis_chf', 0] },
                                {
                                    $divide: [
                                        {
                                            $ifNull: [
                                                '$provision_prozent',
                                                terms.shop_provision_studio_prozent,
                                            ],
                                        },
                                        100,
                                    ],
                                },
                            ],
                        },
                    },
                },
            },
            { $sort: { revenue: -1 } },
        ]),
        Customer.aggregate([
            { $match: { aktuelle_firma_id: new mongoose.Types.ObjectId(studioId) } },
            { $group: { _id: '$akquise_quelle', count: { $sum: 1 } } },
        ]),
    ]);

    const shop = shopAgg[0] || {};
    const sess = sessionAgg[0] || {};
    const sessionRevenue = round2(sess.session_revenue || 0);
    const shopProvision = round2(shop.provision_total || 0);
    const shopElaya = round2(shop.elaya_total || 0);
    const shopGmv = round2(shop.revenue || 0);

    const studioTotal = round2(sessionRevenue + shopProvision);
    const elayaTotal = round2(terms.abo_chf + shopElaya);

    const akquiseMap = Object.fromEntries(
        (akquise || []).map((r) => [r._id || 'unknown', r.count])
    );

    return {
        studio: {
            studio_id: studio._id,
            studio_name: studio.firma || '',
            studio_code: studio.studio_code || '',
            status: studio.status,
            standorte_count: Array.isArray(studio.standorte) ? studio.standorte.length : 0,
            customers_count: customers,
        },
        terms,
        period: {
            from: from.toISOString(),
            to: to.toISOString(),
        },
        pl: {
            studio: {
                session_revenue: sessionRevenue,
                session_count: sess.session_count || 0,
                shop_provision: shopProvision,
                total: studioTotal,
            },
            elaya: {
                abo_chf: terms.abo_chf,
                shop_share: shopElaya,
                total: elayaTotal,
            },
            note: 'Do not sum Studio total and Elaya total — they are separate views of the same period.',
        },
        shop: {
            order_count: shop.order_count || 0,
            revenue: shopGmv,
            provision_total: shopProvision,
            elaya_total: shopElaya,
            pending_provision: round2(shop.pending_provision || 0),
            paid_provision: round2(shop.paid_provision || 0),
        },
        products: (products || []).map((p) => ({
            product_id: p._id?.product_id || null,
            product_name: p._id?.name || '—',
            quantity: p.quantity || 0,
            order_count: Array.isArray(p.order_ids) ? p.order_ids.length : 0,
            revenue: round2(p.revenue),
            commission: round2(p.commission),
        })),
        akquise: {
            studio_eigen: akquiseMap.studio_eigen || 0,
            plattform_vermittelt: akquiseMap.plattform_vermittelt || 0,
            studio_wechsel: akquiseMap.studio_wechsel || 0,
            hint: 'Acquisition source is analysis-only and does not affect fees.',
        },
        invoices: [],
    };
}

/**
 * Super Admin: update package and/or Sonderkonditionen for a studio.
 */
async function patchStudioFinanceTerms(studioId, patch = {}) {
    const studio = await Studio.findById(studioId);
    if (!studio) throw new ApiError(404, 'Studio not found');

    if (patch.package_id) {
        const plan = PACKAGE_TO_PLAN[patch.package_id];
        if (!plan) throw new ApiError(400, 'Invalid package_id (starter|pro|network)');
        studio.subscription_plan = plan;
    } else if (patch.subscription_plan) {
        if (!['basic', 'professional', 'enterprise'].includes(patch.subscription_plan)) {
            throw new ApiError(400, 'Invalid subscription_plan');
        }
        studio.subscription_plan = patch.subscription_plan;
    }

    const touchingOverride =
        patch.preis_override !== undefined ||
        patch.shop_provision_override !== undefined ||
        patch.clear_overrides === true;

    if (touchingOverride) {
        if (patch.clear_overrides) {
            studio.preis_override = null;
            studio.shop_provision_override = null;
            studio.override_grund = '';
            studio.override_datum = null;
        } else {
            const grund = String(patch.override_grund || '').trim();
            if (grund.length < 10) {
                throw new ApiError(
                    400,
                    'override_grund is required (min 10 characters) when setting Sonderkonditionen'
                );
            }
            if (patch.preis_override !== undefined) {
                studio.preis_override = hasOverrideValue(patch.preis_override)
                    ? Number(patch.preis_override)
                    : null;
            }
            if (patch.shop_provision_override !== undefined) {
                studio.shop_provision_override = hasOverrideValue(
                    patch.shop_provision_override
                )
                    ? Number(patch.shop_provision_override)
                    : null;
            }
            studio.override_grund = grund;
            studio.override_datum = new Date();
        }
    }

    await studio.save();
    return getStudioFinanceDetail(studio._id);
}

module.exports = {
    getPlatformFinanceOverview,
    getStudioFinanceDetail,
    patchStudioFinanceTerms,
    currentMonthRange,
    round2,
};

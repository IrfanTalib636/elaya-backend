const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const Session = require('../models/sessionModel');
const Studio = require('../models/studioModel');
const ActivityEvent = require('../models/activityEventModel');
const {
    StudioLead,
    STUDIO_LEAD_STATUS,
    LEAD_AKQUISE,
    LEAD_PAKETE,
    LEAD_PAYMENT,
    normalizeLeadStatus,
} = require('../models/studioLeadModel');
const {
    STUDIO_STATUS,
    APPOINTMENT_STATUS,
    PIPELINE_STUFE,
} = require('../config/constants');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

const CANCELLED = [APPOINTMENT_STATUS.STORNIERT, APPOINTMENT_STATUS.CANCELLED];

const OPEN_LEAD_STATUSES = [
    STUDIO_LEAD_STATUS.LEAD,
    STUDIO_LEAD_STATUS.CONTRACT,
    STUDIO_LEAD_STATUS.CONTRACT_SENT,
    STUDIO_LEAD_STATUS.CONTRACT_SIGNED,
    STUDIO_LEAD_STATUS.ONBOARDING,
];

const testphaseInfo = (abo = {}) => {
    if (!abo.gratismonat_aktiv || !abo.testphase_ende) {
        return { aktiv: false, tage: null, abgelaufen: false, ohneZahlung: !abo.zahlungsweg || abo.zahlungsweg === 'none' };
    }
    const ende = new Date(abo.testphase_ende);
    if (Number.isNaN(ende.getTime())) {
        return { aktiv: false, tage: null, abgelaufen: false, ohneZahlung: !abo.zahlungsweg || abo.zahlungsweg === 'none' };
    }
    const tage = Math.ceil((ende.getTime() - Date.now()) / 86400000);
    return {
        aktiv: true,
        tage,
        abgelaufen: ende.getTime() < Date.now(),
        ohneZahlung: !abo.zahlungsweg || abo.zahlungsweg === 'none',
        ende: ende.toISOString(),
    };
};

const formatLead = (doc) => {
    const l = doc.toObject ? doc.toObject() : doc;
    const status = normalizeLeadStatus(l.status);
    const vertrag = l.vertrag || {};
    const abo = l.abo || {};
    const tp = testphaseInfo(abo);
    return {
        id: String(l._id),
        firma: l.firma,
        kontakt_name: l.kontakt_name || '',
        email: l.email || '',
        telefon: l.telefon || '',
        ort: l.ort || '',
        adresse: l.adresse || '',
        status,
        akquise_weg: l.akquise_weg || 'other',
        gewuenschtes_paket: l.gewuenschtes_paket || 'STARTER',
        demo_termin_gebucht: !!l.demo_termin_gebucht,
        demo_termin_datum: l.demo_termin_datum || null,
        vertrag: {
            status: vertrag.status || 'ENTWURF',
            versendet_am: vertrag.versendet_am || null,
            unterschrieben_am: vertrag.unterschrieben_am || null,
            dokument_referenz: vertrag.dokument_referenz || '',
            signatur_methode: vertrag.signatur_methode || '',
        },
        abo: {
            intervall: abo.intervall || 'monatlich',
            laufzeit_ende: abo.laufzeit_ende || null,
            kuendbar: abo.kuendbar !== false,
            auto_verlaengerung: !!abo.auto_verlaengerung,
            zahlungsweg: abo.zahlungsweg || 'none',
            gratismonat_aktiv: !!abo.gratismonat_aktiv,
            testphase_ende: abo.testphase_ende || null,
        },
        sichtbar_fuer_kunden: status === STUDIO_LEAD_STATUS.ACTIVE,
        testphase: tp,
        notiz: l.notiz || '',
        createdAt: l.createdAt,
        updatedAt: l.updatedAt,
    };
};

/**
 * Platform CRM dashboard: customer funnel, studio registration counts,
 * attention items, and a recent activity slice across all studios.
 */
const getCrmOverview = asyncHandler(async (_req, res) => {
    const [
        appDownloaded,
        customersWithCase,
        customersWithAppointment,
        customersWithSession,
        activeInTreatment,
        studioActive,
        studioPending,
        studioClosed,
        leads,
        pendingLeads,
        recentEvents,
        recentStudios,
    ] = await Promise.all([
        Customer.countDocuments({}),
        Case.distinct('customer').then((ids) => ids.filter(Boolean).length),
        Appointment.distinct('customer', {
            status: { $nin: CANCELLED },
        }).then((ids) => ids.filter(Boolean).length),
        Session.distinct('customer', {
            is_draft: false,
            is_no_show: false,
        }).then((ids) => ids.filter(Boolean).length),
        Customer.countDocuments({
            pipeline_stufe: PIPELINE_STUFE.BEHANDLUNG_AKTIV,
        }),
        Studio.countDocuments({ status: STUDIO_STATUS.AKTIV }),
        Studio.countDocuments({ status: STUDIO_STATUS.AUSSTEHEND }),
        Studio.countDocuments({ status: STUDIO_STATUS.GESPERRT }),
        StudioLead.find().sort({ createdAt: -1 }).limit(50).lean(),
        StudioLead.countDocuments({
            status: { $in: OPEN_LEAD_STATUSES },
        }),
        ActivityEvent.find()
            .sort({ ts: -1 })
            .limit(30)
            .populate('studio', 'firma studio_code')
            .lean(),
        Studio.find()
            .sort({ updatedAt: -1 })
            .limit(10)
            .select('firma studio_code status updatedAt')
            .lean(),
    ]);

    const attention = [];
    if (studioPending > 0) {
        attention.push({
            id: 'pending-studios',
            severity: 'warning',
            title: 'pending_studios',
            count: studioPending,
        });
    }
    if (pendingLeads > 0) {
        attention.push({
            id: 'open-leads',
            severity: 'info',
            title: 'open_leads',
            count: pendingLeads,
        });
    }

    const activityFromEvents = (recentEvents || []).map((e) => ({
        id: String(e._id),
        category: e.category || 'studios',
        title: e.title || e.type || 'Activity',
        detail: e.studio?.firma || e.details || '',
        ts: e.ts || e.createdAt,
    }));

    const activityFallback = (recentStudios || []).map((s) => ({
        id: `studio:${s._id}`,
        category: 'studios',
        title: 'studio_updated',
        detail: s.firma || s.studio_code || '',
        ts: s.updatedAt,
    }));

    res.status(200).json({
        success: true,
        data: {
            pipeline: {
                app_downloaded: appDownloaded,
                case_created: customersWithCase,
                appointment_booked: customersWithAppointment,
                first_session: customersWithSession,
                active_treatment: activeInTreatment,
            },
            studios: {
                active: studioActive,
                pending: studioPending,
                closed: studioClosed,
            },
            leads: leads.map(formatLead),
            attention,
            recent_activity:
                activityFromEvents.length > 0 ? activityFromEvents : activityFallback,
        },
    });
});

const listStudioLeads = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [items, total] = await Promise.all([
        StudioLead.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        StudioLead.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            leads: items.map(formatLead),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const createStudioLead = asyncHandler(async (req, res) => {
    const firma = String(req.body.firma || '').trim();
    if (!firma) throw new ApiError(400, 'firma is required');

    const akquise = String(req.body.akquise_weg || 'other').trim();
    const paket = String(req.body.gewuenschtes_paket || 'STARTER').trim();

    const lead = await StudioLead.create({
        firma,
        kontakt_name: String(req.body.kontakt_name || '').trim(),
        email: String(req.body.email || '').trim().toLowerCase(),
        telefon: String(req.body.telefon || '').trim(),
        ort: String(req.body.ort || '').trim(),
        adresse: String(req.body.adresse || '').trim(),
        notiz: String(req.body.notiz || '').trim(),
        akquise_weg: LEAD_AKQUISE.includes(akquise) ? akquise : 'other',
        gewuenschtes_paket: LEAD_PAKETE.includes(paket) ? paket : 'STARTER',
        demo_termin_gebucht: !!req.body.demo_termin_gebucht,
        demo_termin_datum: req.body.demo_termin_datum
            ? new Date(req.body.demo_termin_datum)
            : null,
        status: STUDIO_LEAD_STATUS.LEAD,
        created_by: req.user?._id || null,
    });

    res.status(201).json({
        success: true,
        data: { lead: formatLead(lead) },
    });
});

const updateStudioLead = asyncHandler(async (req, res) => {
    const lead = await StudioLead.findById(req.params.id);
    if (!lead) throw new ApiError(404, 'Lead not found');

    const fields = [
        'firma',
        'kontakt_name',
        'email',
        'telefon',
        'ort',
        'adresse',
        'notiz',
        'akquise_weg',
        'gewuenschtes_paket',
    ];
    for (const key of fields) {
        if (req.body[key] !== undefined) {
            lead[key] =
                typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
        }
    }
    if (req.body.demo_termin_gebucht !== undefined) {
        lead.demo_termin_gebucht = !!req.body.demo_termin_gebucht;
    }
    if (req.body.demo_termin_datum !== undefined) {
        lead.demo_termin_datum = req.body.demo_termin_datum
            ? new Date(req.body.demo_termin_datum)
            : null;
    }
    if (lead.email) lead.email = lead.email.toLowerCase();
    await lead.save();

    res.status(200).json({
        success: true,
        data: { lead: formatLead(lead) },
    });
});

/**
 * Prototype status actions:
 * send_contract | sign_contract | set_payment | start_trial | activate | deactivate
 */
const advanceStudioLead = asyncHandler(async (req, res) => {
    const lead = await StudioLead.findById(req.params.id);
    if (!lead) throw new ApiError(404, 'Lead not found');

    const action = String(req.body.action || '').trim();
    const status = normalizeLeadStatus(lead.status);
    const now = new Date();

    const vertrag = {
        status: lead.vertrag?.status || 'ENTWURF',
        versendet_am: lead.vertrag?.versendet_am || null,
        unterschrieben_am: lead.vertrag?.unterschrieben_am || null,
        dokument_referenz: lead.vertrag?.dokument_referenz || '',
        signatur_methode: lead.vertrag?.signatur_methode || '',
    };
    const abo = {
        intervall: lead.abo?.intervall || 'monatlich',
        laufzeit_ende: lead.abo?.laufzeit_ende || null,
        kuendbar: lead.abo?.kuendbar !== false,
        auto_verlaengerung: !!lead.abo?.auto_verlaengerung,
        zahlungsweg: lead.abo?.zahlungsweg || 'none',
        gratismonat_aktiv: !!lead.abo?.gratismonat_aktiv,
        testphase_ende: lead.abo?.testphase_ende || null,
    };

    switch (action) {
        case 'send_contract': {
            if (status !== STUDIO_LEAD_STATUS.LEAD) {
                throw new ApiError(400, 'Contract can only be sent from lead status');
            }
            vertrag.status = 'VERSENDET';
            vertrag.versendet_am = now;
            lead.vertrag = vertrag;
            lead.status = STUDIO_LEAD_STATUS.CONTRACT_SENT;
            break;
        }
        case 'sign_contract': {
            if (status !== STUDIO_LEAD_STATUS.CONTRACT_SENT) {
                throw new ApiError(400, 'Contract can only be signed after send');
            }
            vertrag.status = 'UNTERSCHRIEBEN';
            vertrag.unterschrieben_am = now;
            lead.vertrag = vertrag;
            lead.status = STUDIO_LEAD_STATUS.CONTRACT_SIGNED;
            break;
        }
        case 'set_payment': {
            if (status !== STUDIO_LEAD_STATUS.CONTRACT_SIGNED) {
                throw new ApiError(400, 'Payment can only be set after contract signed');
            }
            const zahlungsweg = String(req.body.zahlungsweg || '').trim();
            if (!['STRIPE_KARTE', 'RECHNUNG'].includes(zahlungsweg)) {
                throw new ApiError(400, 'zahlungsweg must be STRIPE_KARTE or RECHNUNG');
            }
            abo.zahlungsweg = zahlungsweg;
            lead.abo = abo;
            lead.status = STUDIO_LEAD_STATUS.ONBOARDING;
            break;
        }
        case 'start_trial': {
            if (status !== STUDIO_LEAD_STATUS.CONTRACT_SIGNED) {
                throw new ApiError(400, 'Trial can only start after contract signed');
            }
            abo.gratismonat_aktiv = true;
            abo.testphase_ende = new Date(Date.now() + 30 * 86400000);
            lead.abo = abo;
            lead.status = STUDIO_LEAD_STATUS.ONBOARDING;
            break;
        }
        case 'activate': {
            if (status !== STUDIO_LEAD_STATUS.ONBOARDING) {
                throw new ApiError(400, 'Studio can only be activated from onboarding');
            }
            lead.status = STUDIO_LEAD_STATUS.ACTIVE;
            break;
        }
        case 'deactivate': {
            lead.status = STUDIO_LEAD_STATUS.DEACTIVATED;
            break;
        }
        default:
            throw new ApiError(400, `Unknown action: ${action}`);
    }

    await lead.save();

    res.status(200).json({
        success: true,
        data: { lead: formatLead(lead) },
    });
});

module.exports = {
    getCrmOverview,
    listStudioLeads,
    createStudioLead,
    updateStudioLead,
    advanceStudioLead,
};

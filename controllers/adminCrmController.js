const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');
const Appointment = require('../models/appointmentModel');
const Session = require('../models/sessionModel');
const Studio = require('../models/studioModel');
const ActivityEvent = require('../models/activityEventModel');
const { StudioLead, STUDIO_LEAD_STATUS } = require('../models/studioLeadModel');
const {
    STUDIO_STATUS,
    APPOINTMENT_STATUS,
    PIPELINE_STUFE,
} = require('../config/constants');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

const CANCELLED = [APPOINTMENT_STATUS.STORNIERT, APPOINTMENT_STATUS.CANCELLED];

const formatLead = (doc) => {
    const l = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(l._id),
        firma: l.firma,
        kontakt_name: l.kontakt_name || '',
        email: l.email || '',
        telefon: l.telefon || '',
        ort: l.ort || '',
        status: l.status,
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
            status: {
                $in: [
                    STUDIO_LEAD_STATUS.LEAD,
                    STUDIO_LEAD_STATUS.CONTRACT,
                    STUDIO_LEAD_STATUS.ONBOARDING,
                ],
            },
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

    const lead = await StudioLead.create({
        firma,
        kontakt_name: String(req.body.kontakt_name || '').trim(),
        email: String(req.body.email || '').trim().toLowerCase(),
        telefon: String(req.body.telefon || '').trim(),
        ort: String(req.body.ort || '').trim(),
        notiz: String(req.body.notiz || '').trim(),
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

    const fields = ['firma', 'kontakt_name', 'email', 'telefon', 'ort', 'notiz', 'status'];
    for (const key of fields) {
        if (req.body[key] !== undefined) {
            lead[key] = typeof req.body[key] === 'string' ? req.body[key].trim() : req.body[key];
        }
    }
    if (lead.email) lead.email = lead.email.toLowerCase();
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
};

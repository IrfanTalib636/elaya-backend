const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Customer = require('../models/customerModel');
const Appointment = require('../models/appointmentModel');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const { StudioLead, normalizeLeadStatus } = require('../models/studioLeadModel');
const PlatformCrmTask = require('../models/platformCrmTaskModel');
const PlatformCrmNote = require('../models/platformCrmNoteModel');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { APPOINTMENT_STATUS } = require('../config/constants');
const {
    CUSTOMER_FUNNEL_STAGE_ORDER,
    STUDIO_FUNNEL_STAGE_ORDER,
    CUSTOMER_DROPOFF,
    CUSTOMER_DROPOFFS,
    STUDIO_DROPOFF,
    STUDIO_DROPOFFS,
    PLATFORM_CRM_SUBJECT_TYPE,
    PLATFORM_CRM_STUCK_DAYS,
    CUSTOMER_FUNNEL_ACTION,
    STUDIO_FUNNEL_ACTION,
    isCustomerFunnelStage,
    isStudioFunnelStage,
    isCustomerDropoff,
    isStudioDropoff,
    isPlatformCrmSubjectType,
} = require('../config/platformCrmConfig');
const {
    syncCustomerPlatformCrm,
    syncStudioLeadPlatformCrm,
    computeCustomerFunnel,
    computeStudioLeadFunnel,
    daysSince,
} = require('../utils/platformFunnelEngine');

const CANCELLED_APPOINTMENT = [
    APPOINTMENT_STATUS.STORNIERT,
    APPOINTMENT_STATUS.CANCELLED,
];

const assertObjectId = (id, label = 'id') => {
    if (!mongoose.isValidObjectId(id)) {
        throw new ApiError(400, `Invalid ${label}`);
    }
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stuckCutoff = () =>
    new Date(Date.now() - PLATFORM_CRM_STUCK_DAYS * 24 * 60 * 60 * 1000);

/** Customer IDs with cancelled appt(s) and no open appt. */
const customerIdsCancelledNotRebooked = async () => {
    const [cancelled, open] = await Promise.all([
        Appointment.distinct('customer', { status: { $in: CANCELLED_APPOINTMENT } }),
        Appointment.distinct('customer', { status: { $nin: CANCELLED_APPOINTMENT } }),
    ]);
    const openSet = new Set(open.filter(Boolean).map(String));
    return cancelled.filter((id) => id && !openSet.has(String(id)));
};

const buildCustomerFilter = async ({ stage, dropoff, q }) => {
    const filter = {};

    if (stage) {
        if (!isCustomerFunnelStage(stage)) {
            throw new ApiError(400, `Invalid customer stage: ${stage}`);
        }
        filter['platform_crm.funnel_stage'] = stage;
    }

    if (dropoff) {
        if (!isCustomerDropoff(dropoff)) {
            throw new ApiError(400, `Invalid customer dropoff: ${dropoff}`);
        }
        switch (dropoff) {
            case CUSTOMER_DROPOFF.REGISTERED_NO_STUDIO:
                filter.$or = [
                    { aktuelle_firma_id: null },
                    { aktuelle_firma_id: { $exists: false } },
                ];
                break;
            case CUSTOMER_DROPOFF.STUDIO_NO_CASE_STARTED:
                filter.aktuelle_firma_id = { $ne: null };
                filter['platform_crm.cases_count'] = { $lte: 0 };
                break;
            case CUSTOMER_DROPOFF.CASE_STARTED_NOT_CREATED:
                filter['platform_crm.has_draft_case'] = true;
                filter['platform_crm.funnel_stage'] = 'case_started';
                break;
            case CUSTOMER_DROPOFF.CASE_CREATED_NO_APPOINTMENT:
                filter['platform_crm.funnel_stage'] = 'case_created';
                filter['platform_crm.has_open_appointment'] = false;
                break;
            case CUSTOMER_DROPOFF.APPOINTMENT_CANCELLED_NOT_REBOOKED: {
                const ids = await customerIdsCancelledNotRebooked();
                filter._id = { $in: ids };
                break;
            }
            default:
                break;
        }
    }

    if (q && String(q).trim()) {
        const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
        filter.$and = (filter.$and || []).concat([
            {
                $or: [
                    { vorname: rx },
                    { nachname: rx },
                    { email: rx },
                    { telefon: rx },
                ],
            },
        ]);
    }

    return filter;
};

const buildStudioLeadFilter = ({ stage, dropoff, q }) => {
    const filter = {};

    if (stage) {
        if (!isStudioFunnelStage(stage)) {
            throw new ApiError(400, `Invalid studio stage: ${stage}`);
        }
        filter['platform_crm.funnel_stage'] = stage;
    }

    if (dropoff) {
        if (!isStudioDropoff(dropoff)) {
            throw new ApiError(400, `Invalid studio dropoff: ${dropoff}`);
        }
        filter['platform_crm.stage_entered_at'] = { $lte: stuckCutoff() };
        switch (dropoff) {
            case STUDIO_DROPOFF.LEAD_STALLED:
                filter['platform_crm.funnel_stage'] = {
                    $in: ['lead', 'registration_started', 'registration_completed'],
                };
                break;
            case STUDIO_DROPOFF.VERIFICATION_STALLED:
                filter['platform_crm.funnel_stage'] = 'verification_pending';
                break;
            case STUDIO_DROPOFF.CONTRACT_STALLED:
                filter['platform_crm.funnel_stage'] = 'contract_pending';
                break;
            case STUDIO_DROPOFF.ONBOARDING_STALLED:
                filter['platform_crm.funnel_stage'] = {
                    $in: ['onboarding_started', 'onboarding_incomplete'],
                };
                break;
            default:
                break;
        }
    }

    if (q && String(q).trim()) {
        const rx = new RegExp(escapeRegex(String(q).trim()), 'i');
        filter.$or = [
            { firma: rx },
            { kontakt_name: rx },
            { email: rx },
            { telefon: rx },
            { ort: rx },
        ];
    }

    return filter;
};

const formatCustomerListItem = (doc) => {
    const pc = doc.platform_crm || {};
    return {
        id: String(doc._id),
        vorname: doc.vorname,
        nachname: doc.nachname,
        email: doc.email,
        telefon: doc.telefon,
        registriert_am: doc.registriert_am || doc.createdAt,
        studio_id: doc.aktuelle_firma_id?._id
            ? String(doc.aktuelle_firma_id._id)
            : doc.aktuelle_firma_id
              ? String(doc.aktuelle_firma_id)
              : null,
        studio_name: doc.aktuelle_firma_id?.firma || null,
        funnel_stage: pc.funnel_stage || null,
        stage_entered_at: pc.stage_entered_at || null,
        last_activity_at: pc.last_activity_at || null,
        days_in_stage: daysSince(pc.stage_entered_at),
        cases_count: pc.cases_count ?? 0,
        has_draft_case: !!pc.has_draft_case,
        has_open_appointment: !!pc.has_open_appointment,
        first_session_at: pc.first_session_at || null,
        completed_at: pc.completed_at || null,
        recommended_action: CUSTOMER_FUNNEL_ACTION[pc.funnel_stage] || '',
        // Studio CRM field — read-only for context, not Admin funnel
        studio_pipeline_stufe: doc.pipeline_stufe || null,
    };
};

const formatStudioLeadListItem = (doc) => {
    const pc = doc.platform_crm || {};
    return {
        id: String(doc._id),
        firma: doc.firma,
        kontakt_name: doc.kontakt_name || '',
        email: doc.email || '',
        telefon: doc.telefon || '',
        ort: doc.ort || '',
        status: normalizeLeadStatus(doc.status),
        funnel_stage: pc.funnel_stage || null,
        stage_entered_at: pc.stage_entered_at || null,
        last_activity_at: pc.last_activity_at || null,
        days_in_stage: daysSince(pc.stage_entered_at),
        missing_steps: pc.missing_steps || [],
        linked_studio_id: pc.linked_studio_id ? String(pc.linked_studio_id) : null,
        recommended_action: STUDIO_FUNNEL_ACTION[pc.funnel_stage] || '',
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
    };
};

const formatPlatformTask = (doc) => {
    const t = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(t._id),
        subject_type: t.subject_type,
        subject_id: String(t.subject_id),
        customer: t.customer
            ? typeof t.customer === 'object' && t.customer._id
                ? {
                      id: String(t.customer._id),
                      vorname: t.customer.vorname,
                      nachname: t.customer.nachname,
                  }
                : String(t.customer)
            : null,
        studio_lead: t.studio_lead
            ? typeof t.studio_lead === 'object' && t.studio_lead._id
                ? {
                      id: String(t.studio_lead._id),
                      firma: t.studio_lead.firma,
                  }
                : String(t.studio_lead)
            : null,
        studio: t.studio ? String(t.studio._id || t.studio) : null,
        titel: t.titel,
        typ: t.typ,
        prioritaet: t.prioritaet,
        faellig_am: t.faellig_am,
        zugewiesen_an: t.zugewiesen_an || '',
        erledigt: !!t.erledigt,
        erledigt_am: t.erledigt_am || null,
        erstellt_von: t.erstellt_von ? String(t.erstellt_von) : null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
    };
};

const formatPlatformNote = (doc) => {
    const n = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(n._id),
        subject_type: n.subject_type,
        subject_id: String(n.subject_id),
        customer: n.customer ? String(n.customer._id || n.customer) : null,
        studio_lead: n.studio_lead ? String(n.studio_lead._id || n.studio_lead) : null,
        studio: n.studio ? String(n.studio._id || n.studio) : null,
        typ: n.typ,
        inhalt: n.inhalt,
        erstellt_von: n.erstellt_von ? String(n.erstellt_von) : null,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
    };
};

const resolveSubjectRefs = async ({ subject_type, subject_id }) => {
    if (!isPlatformCrmSubjectType(subject_type)) {
        throw new ApiError(400, `Invalid subject_type: ${subject_type}`);
    }
    assertObjectId(subject_id, 'subject_id');

    const refs = {
        subject_type,
        subject_id,
        customer: null,
        studio_lead: null,
        studio: null,
    };

    if (subject_type === PLATFORM_CRM_SUBJECT_TYPE.CUSTOMER) {
        const customer = await Customer.findById(subject_id)
            .select('_id aktuelle_firma_id')
            .lean();
        if (!customer) throw new ApiError(404, 'Customer not found');
        refs.customer = customer._id;
        refs.studio = customer.aktuelle_firma_id || null;
    } else if (subject_type === PLATFORM_CRM_SUBJECT_TYPE.STUDIO_LEAD) {
        const lead = await StudioLead.findById(subject_id)
            .select('_id platform_crm.linked_studio_id')
            .lean();
        if (!lead) throw new ApiError(404, 'Studio lead not found');
        refs.studio_lead = lead._id;
        refs.studio = lead.platform_crm?.linked_studio_id || null;
    } else if (subject_type === PLATFORM_CRM_SUBJECT_TYPE.STUDIO) {
        refs.studio = subject_id;
    }

    return refs;
};

const countByStage = async (Model, stages, field = 'platform_crm.funnel_stage') => {
    const rows = await Model.aggregate([
        { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    ]);
    const map = Object.fromEntries(stages.map((s) => [s, 0]));
    for (const row of rows) {
        if (row._id && map[row._id] !== undefined) {
            map[row._id] = row.count;
        }
    }
    return map;
};


const getPlatformFunnel = asyncHandler(async (_req, res) => {
    const [
        customer_stages,
        studio_stages,
        registered_no_studio,
        studio_no_case,
        case_started_not_created,
        case_created_no_appt,
        cancelled_not_rebooked_ids,
        lead_stalled,
        verification_stalled,
        contract_stalled,
        onboarding_stalled,
        open_tasks,
    ] = await Promise.all([
        countByStage(Customer, CUSTOMER_FUNNEL_STAGE_ORDER),
        countByStage(StudioLead, STUDIO_FUNNEL_STAGE_ORDER),
        Customer.countDocuments({
            $or: [{ aktuelle_firma_id: null }, { aktuelle_firma_id: { $exists: false } }],
        }),
        Customer.countDocuments({
            aktuelle_firma_id: { $ne: null },
            'platform_crm.cases_count': { $lte: 0 },
        }),
        Customer.countDocuments({
            'platform_crm.has_draft_case': true,
            'platform_crm.funnel_stage': 'case_started',
        }),
        Customer.countDocuments({
            'platform_crm.funnel_stage': 'case_created',
            'platform_crm.has_open_appointment': false,
        }),
        customerIdsCancelledNotRebooked(),
        StudioLead.countDocuments(buildStudioLeadFilter({ dropoff: STUDIO_DROPOFF.LEAD_STALLED })),
        StudioLead.countDocuments(
            buildStudioLeadFilter({ dropoff: STUDIO_DROPOFF.VERIFICATION_STALLED })
        ),
        StudioLead.countDocuments(
            buildStudioLeadFilter({ dropoff: STUDIO_DROPOFF.CONTRACT_STALLED })
        ),
        StudioLead.countDocuments(
            buildStudioLeadFilter({ dropoff: STUDIO_DROPOFF.ONBOARDING_STALLED })
        ),
        PlatformCrmTask.countDocuments({ erledigt: false }),
    ]);

    res.status(200).json({
        success: true,
        data: {
            customers: {
                stages: customer_stages,
                total: Object.values(customer_stages).reduce((a, b) => a + b, 0),
                dropoffs: {
                    [CUSTOMER_DROPOFF.REGISTERED_NO_STUDIO]: registered_no_studio,
                    [CUSTOMER_DROPOFF.STUDIO_NO_CASE_STARTED]: studio_no_case,
                    [CUSTOMER_DROPOFF.CASE_STARTED_NOT_CREATED]: case_started_not_created,
                    [CUSTOMER_DROPOFF.CASE_CREATED_NO_APPOINTMENT]: case_created_no_appt,
                    [CUSTOMER_DROPOFF.APPOINTMENT_CANCELLED_NOT_REBOOKED]:
                        cancelled_not_rebooked_ids.length,
                },
            },
            studios: {
                stages: studio_stages,
                total: Object.values(studio_stages).reduce((a, b) => a + b, 0),
                dropoffs: {
                    [STUDIO_DROPOFF.LEAD_STALLED]: lead_stalled,
                    [STUDIO_DROPOFF.VERIFICATION_STALLED]: verification_stalled,
                    [STUDIO_DROPOFF.CONTRACT_STALLED]: contract_stalled,
                    [STUDIO_DROPOFF.ONBOARDING_STALLED]: onboarding_stalled,
                },
            },
            open_tasks,
            stuck_days: PLATFORM_CRM_STUCK_DAYS,
            stage_order: {
                customers: CUSTOMER_FUNNEL_STAGE_ORDER,
                studios: STUDIO_FUNNEL_STAGE_ORDER,
            },
            dropoff_keys: {
                customers: CUSTOMER_DROPOFFS,
                studios: STUDIO_DROPOFFS,
            },
        },
    });
});


const listPlatformCustomers = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = await buildCustomerFilter({
        stage: req.query.stage,
        dropoff: req.query.dropoff,
        q: req.query.q,
    });

    const [items, total] = await Promise.all([
        Customer.find(filter)
            .select(
                'vorname nachname email telefon registriert_am createdAt aktuelle_firma_id pipeline_stufe platform_crm'
            )
            .populate('aktuelle_firma_id', 'firma')
            .sort({ 'platform_crm.last_activity_at': -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Customer.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            customers: items.map(formatCustomerListItem),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});


const getPlatformCustomerDetail = asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'customer id');

    await syncCustomerPlatformCrm(req.params.id);

    const customer = await Customer.findById(req.params.id)
        .select(
            'vorname nachname email telefon registriert_am createdAt updatedAt aktuelle_firma_id pipeline_stufe stufe_seit platform_crm'
        )
        .populate('aktuelle_firma_id', 'firma studio_code status ort')
        .lean();

    if (!customer) throw new ApiError(404, 'Customer not found');

    const [snapshot, cases, appointments, sessions, tasks, notes] = await Promise.all([
        computeCustomerFunnel(req.params.id),
        Case.find({ customer: req.params.id })
            .select('caseId status createdAt updatedAt')
            .sort({ createdAt: -1 })
            .limit(20)
            .lean(),
        Appointment.find({ customer: req.params.id })
            .select('date status type createdAt')
            .sort({ date: -1 })
            .limit(20)
            .lean(),
        Session.find({ customer: req.params.id, is_draft: false })
            .select('treatment_date is_no_show createdAt')
            .sort({ treatment_date: -1 })
            .limit(20)
            .lean(),
        PlatformCrmTask.find({
            subject_type: PLATFORM_CRM_SUBJECT_TYPE.CUSTOMER,
            subject_id: req.params.id,
        })
            .sort({ erledigt: 1, faellig_am: 1 })
            .limit(50)
            .lean(),
        PlatformCrmNote.find({
            subject_type: PLATFORM_CRM_SUBJECT_TYPE.CUSTOMER,
            subject_id: req.params.id,
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean(),
    ]);

    res.status(200).json({
        success: true,
        data: {
            customer: {
                ...formatCustomerListItem(customer),
                studio: customer.aktuelle_firma_id
                    ? {
                          id: String(customer.aktuelle_firma_id._id),
                          firma: customer.aktuelle_firma_id.firma,
                          studio_code: customer.aktuelle_firma_id.studio_code,
                          status: customer.aktuelle_firma_id.status,
                          ort: customer.aktuelle_firma_id.ort,
                      }
                    : null,
                dropoffs: snapshot?.dropoffs || [],
                recommended_action: snapshot?.recommended_action || '',
            },
            cases: cases.map((c) => ({
                id: String(c._id),
                caseId: c.caseId,
                status: c.status,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
            })),
            appointments: appointments.map((a) => ({
                id: String(a._id),
                date: a.date,
                status: a.status,
                type: a.type,
                createdAt: a.createdAt,
            })),
            sessions: sessions.map((s) => ({
                id: String(s._id),
                treatment_date: s.treatment_date,
                is_no_show: s.is_no_show,
                createdAt: s.createdAt,
            })),
            tasks: tasks.map(formatPlatformTask),
            notes: notes.map(formatPlatformNote),
        },
    });
});


const listPlatformStudioLeads = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = buildStudioLeadFilter({
        stage: req.query.stage,
        dropoff: req.query.dropoff,
        q: req.query.q,
    });

    const [items, total] = await Promise.all([
        StudioLead.find(filter)
            .sort({ 'platform_crm.last_activity_at': -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        StudioLead.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            leads: items.map(formatStudioLeadListItem),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});


const getPlatformStudioLeadDetail = asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'lead id');

    await syncStudioLeadPlatformCrm(req.params.id);

    const lead = await StudioLead.findById(req.params.id).lean();
    if (!lead) throw new ApiError(404, 'Studio lead not found');

    const [snapshot, tasks, notes] = await Promise.all([
        computeStudioLeadFunnel(req.params.id),
        PlatformCrmTask.find({
            subject_type: PLATFORM_CRM_SUBJECT_TYPE.STUDIO_LEAD,
            subject_id: req.params.id,
        })
            .sort({ erledigt: 1, faellig_am: 1 })
            .limit(50)
            .lean(),
        PlatformCrmNote.find({
            subject_type: PLATFORM_CRM_SUBJECT_TYPE.STUDIO_LEAD,
            subject_id: req.params.id,
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean(),
    ]);

    res.status(200).json({
        success: true,
        data: {
            lead: {
                ...formatStudioLeadListItem(lead),
                adresse: lead.adresse || '',
                akquise_weg: lead.akquise_weg,
                gewuenschtes_paket: lead.gewuenschtes_paket,
                notiz: lead.notiz || '',
                vertrag: lead.vertrag || {},
                abo: lead.abo || {},
                dropoffs: snapshot?.dropoffs || [],
                recommended_action: snapshot?.recommended_action || '',
            },
            tasks: tasks.map(formatPlatformTask),
            notes: notes.map(formatPlatformNote),
        },
    });
});


const listPlatformTasks = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    if (req.query.status === 'open') filter.erledigt = false;
    else if (req.query.status === 'done') filter.erledigt = true;

    if (req.query.subject_type) {
        if (!isPlatformCrmSubjectType(req.query.subject_type)) {
            throw new ApiError(400, 'Invalid subject_type');
        }
        filter.subject_type = req.query.subject_type;
    }
    if (req.query.subject_id) {
        assertObjectId(req.query.subject_id, 'subject_id');
        filter.subject_id = req.query.subject_id;
    }

    const [items, total] = await Promise.all([
        PlatformCrmTask.find(filter)
            .populate('customer', 'vorname nachname')
            .populate('studio_lead', 'firma')
            .sort({ erledigt: 1, faellig_am: 1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        PlatformCrmTask.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            tasks: items.map(formatPlatformTask),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});


const createPlatformTask = asyncHandler(async (req, res) => {
    const refs = await resolveSubjectRefs({
        subject_type: req.body.subject_type,
        subject_id: req.body.subject_id,
    });

    const faelligDate = new Date(req.body.faellig_am);
    if (Number.isNaN(faelligDate.getTime())) {
        throw new ApiError(400, 'Invalid faellig_am date');
    }

    const task = await PlatformCrmTask.create({
        ...refs,
        titel: String(req.body.titel || '').trim(),
        typ: req.body.typ,
        prioritaet: req.body.prioritaet,
        faellig_am: faelligDate,
        zugewiesen_an: String(req.body.zugewiesen_an || '').trim(),
        erstellt_von: req.user?._id || null,
    });

    await task.populate('customer', 'vorname nachname');
    await task.populate('studio_lead', 'firma');

    res.status(201).json({
        success: true,
        data: { task: formatPlatformTask(task) },
    });
});


const updatePlatformTask = asyncHandler(async (req, res) => {
    assertObjectId(req.params.id, 'task id');
    const task = await PlatformCrmTask.findById(req.params.id);
    if (!task) throw new ApiError(404, 'Task not found');

    const { titel, typ, prioritaet, faellig_am, zugewiesen_an, erledigt } = req.body;

    if (titel !== undefined) task.titel = String(titel).trim();
    if (typ !== undefined) task.typ = typ;
    if (prioritaet !== undefined) task.prioritaet = prioritaet;
    if (zugewiesen_an !== undefined) task.zugewiesen_an = String(zugewiesen_an).trim();
    if (faellig_am !== undefined) {
        const d = new Date(faellig_am);
        if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Invalid faellig_am date');
        task.faellig_am = d;
    }
    if (erledigt !== undefined) {
        task.erledigt = !!erledigt;
        task.erledigt_am = task.erledigt ? new Date() : null;
    }

    await task.save();
    await task.populate('customer', 'vorname nachname');
    await task.populate('studio_lead', 'firma');

    res.status(200).json({
        success: true,
        data: { task: formatPlatformTask(task) },
    });
});


const listPlatformNotes = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    if (req.query.subject_type) {
        if (!isPlatformCrmSubjectType(req.query.subject_type)) {
            throw new ApiError(400, 'Invalid subject_type');
        }
        filter.subject_type = req.query.subject_type;
    }
    if (req.query.subject_id) {
        assertObjectId(req.query.subject_id, 'subject_id');
        filter.subject_id = req.query.subject_id;
    }
    if (!filter.subject_id && !filter.subject_type) {
        throw new ApiError(400, 'subject_type and subject_id are required');
    }

    const [items, total] = await Promise.all([
        PlatformCrmNote.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        PlatformCrmNote.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            notes: items.map(formatPlatformNote),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});


const createPlatformNote = asyncHandler(async (req, res) => {
    const refs = await resolveSubjectRefs({
        subject_type: req.body.subject_type,
        subject_id: req.body.subject_id,
    });

    const inhalt = String(req.body.inhalt || '').trim();
    if (!inhalt) throw new ApiError(400, 'inhalt is required');

    const note = await PlatformCrmNote.create({
        ...refs,
        typ: req.body.typ,
        inhalt,
        erstellt_von: req.user?._id || null,
    });

    res.status(201).json({
        success: true,
        data: { note: formatPlatformNote(note) },
    });
});

module.exports = {
    getPlatformFunnel,
    listPlatformCustomers,
    getPlatformCustomerDetail,
    listPlatformStudioLeads,
    getPlatformStudioLeadDetail,
    listPlatformTasks,
    createPlatformTask,
    updatePlatformTask,
    listPlatformNotes,
    createPlatformNote,
};

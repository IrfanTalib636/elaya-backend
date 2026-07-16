const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');
const CrmTask = require('../models/crmTaskModel');
const CrmNote = require('../models/crmNoteModel');
const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { resolveStudioId } = require('../utils/studioScope');
const {
    syncStudioPipeline,
    daysSince,
    PIPELINE_ORDER,
} = require('../utils/pipelineEngine');
const {
    getStageAktion,
    getLeadTemplate,
} = require('../config/crmDefaults');
const { aggregateMedicalFlagsByCustomer } = require('../utils/medicalFlagHelpers');

const assertCustomerInStudio = async (customerId, studioId) => {
    if (!customerId) return null;
    const customer = await Customer.findById(customerId).select('aktuelle_firma_id vorname nachname pipeline_stufe').lean();
    if (!customer || customer.aktuelle_firma_id.toString() !== studioId.toString()) {
        throw new ApiError(404, 'Customer not found');
    }
    return customer;
};

const formatCrmTask = (task, medicalMap = {}) => {
    const customerId = task.customer?._id?.toString() ?? task.customer?.toString() ?? null;
    const medical = customerId ? medicalMap[customerId] : null;

    return {
        id: task._id,
        customer_id: task.customer?._id ?? task.customer ?? null,
        kunden_name: task.customer
            ? `${task.customer.vorname ?? ''} ${task.customer.nachname ?? ''}`.trim()
            : null,
        titel: task.titel,
        typ: task.typ,
        prioritaet: task.prioritaet,
        faellig_am: task.faellig_am,
        zugewiesen_an: task.zugewiesen_an ?? '',
        erledigt: task.erledigt,
        erledigt_am: task.erledigt_am,
        erstellt_am: task.createdAt,
        worst_medical_flag_level: medical?.worst_medical_flag_level ?? null,
        open_medical_flags_count: medical?.open_medical_flags_count ?? 0,
        pending_anamnesis_count: medical?.pending_anamnesis_count ?? 0,
    };
};

const formatCrmNote = (note) => ({
    id: note._id,
    customer_id: note.customer?._id ?? note.customer,
    kunden_name: note.customer
        ? `${note.customer.vorname ?? ''} ${note.customer.nachname ?? ''}`.trim()
        : null,
    typ: note.typ,
    inhalt: note.inhalt,
    erstellt_am: note.createdAt,
});

const formatCrmCustomer = (customer, openCases) => ({
    id: customer._id,
    vorname: customer.vorname,
    nachname: customer.nachname,
    email: customer.email,
    telefon: customer.telefon,
    pipeline_stufe: customer.pipeline_stufe,
    stufe_seit: customer.stufe_seit,
    stufe_seit_tage: daysSince(customer.stufe_seit),
    akquise_quelle: customer.akquise_quelle,
    registriert_am: customer.registriert_am,
    offene_faelle: openCases,
});

/**
 * GET /studio/crm/pipeline
 * Returns kanban columns grouped by pipeline_stufe (auto-synced on load).
 */
const getCrmPipeline = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);

    const synced = await syncStudioPipeline(studioId);

    const customers = await Customer.find({ aktuelle_firma_id: studioId })
        .sort({ stufe_seit: 1, nachname: 1, vorname: 1 })
        .select('-elaycoins.transactions -firma_history')
        .lean();

    const ids = customers.map((c) => c._id);
    const studioOid = new mongoose.Types.ObjectId(studioId);
    const [caseCounts, totalCaseCounts, nextTasks, lastNotes, medicalMap] = await Promise.all([
        Case.aggregate([
            { $match: { customer: { $in: ids }, status: { $in: ['pending', 'active'] } } },
            { $group: { _id: '$customer', count: { $sum: 1 } } },
        ]),
        Case.aggregate([
            { $match: { customer: { $in: ids } } },
            { $group: { _id: '$customer', count: { $sum: 1 } } },
        ]),
        CrmTask.aggregate([
            { $match: { studio: studioOid, erledigt: false, customer: { $in: ids } } },
            { $sort: { faellig_am: 1 } },
            { $group: { _id: '$customer', titel: { $first: '$titel' }, faellig_am: { $first: '$faellig_am' } } },
        ]),
        CrmNote.aggregate([
            { $match: { studio: studioOid, customer: { $in: ids } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: '$customer', erstellt_am: { $first: '$createdAt' } } },
        ]),
        aggregateMedicalFlagsByCustomer(ids),
    ]);
    const countMap = Object.fromEntries(caseCounts.map((x) => [x._id.toString(), x.count]));
    const totalMap = Object.fromEntries(totalCaseCounts.map((x) => [x._id.toString(), x.count]));
    const taskMap = Object.fromEntries(nextTasks.map((x) => [x._id.toString(), x]));
    const noteMap = Object.fromEntries(lastNotes.map((x) => [x._id.toString(), x.erstellt_am]));

    const formatted = customers.map((c) => {
        const id = c._id.toString();
        const next = taskMap[id];
        const faelleGesamt = totalMap[id] ?? 0;
        const medical = medicalMap[id] ?? {};
        return {
            ...formatCrmCustomer(c, countMap[id] ?? 0),
            faelle_gesamt: faelleGesamt,
            aktion: getStageAktion(c.pipeline_stufe, faelleGesamt),
            naechste_aufgabe: next ? { titel: next.titel, faellig_am: next.faellig_am } : null,
            letzter_kontakt: noteMap[id] ?? null,
            worst_medical_flag_level: medical.worst_medical_flag_level ?? null,
            open_medical_flags_count: medical.open_medical_flags_count ?? 0,
            pending_anamnesis_count: medical.pending_anamnesis_count ?? 0,
        };
    });

    const byStage = Object.fromEntries(PIPELINE_ORDER.map((stage) => [stage, []]));
    formatted.forEach((c) => {
        const stage = PIPELINE_ORDER.includes(c.pipeline_stufe) ? c.pipeline_stufe : PIPELINE_ORDER[0];
        byStage[stage].push(c);
    });

    const columns = PIPELINE_ORDER.map((stage) => ({
        stage,
        total: byStage[stage].length,
        customers: byStage[stage],
    }));

    res.json({
        success: true,
        data: {
            columns,
            total: customers.length,
            synced,
        },
    });
});

/** GET /studio/crm/tasks */
const listCrmTasks = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const { customer_id, status = 'open' } = req.query;

    const filter = { studio: studioId };
    if (customer_id) filter.customer = customer_id;
    if (status === 'open') filter.erledigt = false;
    else if (status === 'done') filter.erledigt = true;

    const tasks = await CrmTask.find(filter)
        .populate('customer', 'vorname nachname')
        .sort({ faellig_am: 1, createdAt: -1 })
        .lean();

    const customerIds = [
        ...new Set(
            tasks
                .map((t) => t.customer?._id ?? t.customer)
                .filter(Boolean)
        ),
    ];
    const medicalMap = await aggregateMedicalFlagsByCustomer(customerIds);

    res.json({
        success: true,
        data: { tasks: tasks.map((t) => formatCrmTask(t, medicalMap)) },
    });
});

/** POST /studio/crm/tasks */
const createCrmTask = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const { customer_id, titel, typ, prioritaet, faellig_am, zugewiesen_an } = req.body;

    const faelligDate = new Date(faellig_am);
    if (Number.isNaN(faelligDate.getTime())) {
        throw new ApiError(400, 'Invalid faellig_am date');
    }

    if (customer_id) {
        await assertCustomerInStudio(customer_id, studioId);
    }

    const task = await CrmTask.create({
        studio: studioId,
        customer: customer_id || null,
        titel,
        typ,
        prioritaet,
        faellig_am: faelligDate,
        zugewiesen_an: zugewiesen_an ?? '',
        erstellt_von: req.user._id,
    });

    await task.populate('customer', 'vorname nachname');

    res.status(201).json({
        success: true,
        data: { task: formatCrmTask(task.toObject()) },
    });
});

/** PATCH /studio/crm/tasks/:id */
const updateCrmTask = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const task = await CrmTask.findOne({ _id: req.params.id, studio: studioId });
    if (!task) throw new ApiError(404, 'Task not found');

    const { titel, typ, prioritaet, faellig_am, zugewiesen_an, erledigt } = req.body;

    if (titel !== undefined) task.titel = titel;
    if (typ !== undefined) task.typ = typ;
    if (prioritaet !== undefined) task.prioritaet = prioritaet;
    if (zugewiesen_an !== undefined) task.zugewiesen_an = zugewiesen_an;
    if (faellig_am !== undefined) {
        const d = new Date(faellig_am);
        if (Number.isNaN(d.getTime())) throw new ApiError(400, 'Invalid faellig_am date');
        task.faellig_am = d;
    }
    if (erledigt !== undefined) {
        task.erledigt = erledigt;
        task.erledigt_am = erledigt ? new Date() : null;
    }

    await task.save();
    await task.populate('customer', 'vorname nachname');

    res.json({
        success: true,
        data: { task: formatCrmTask(task.toObject()) },
    });
});

/** DELETE /studio/crm/tasks/:id */
const deleteCrmTask = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const task = await CrmTask.findOneAndDelete({ _id: req.params.id, studio: studioId });
    if (!task) throw new ApiError(404, 'Task not found');
    res.json({ success: true });
});

/** GET /studio/crm/notes */
const listCrmNotes = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const { customer_id } = req.query;
    if (!customer_id) throw new ApiError(400, 'customer_id is required');

    await assertCustomerInStudio(customer_id, studioId);

    const notes = await CrmNote.find({ studio: studioId, customer: customer_id })
        .populate('customer', 'vorname nachname')
        .sort({ createdAt: -1 })
        .lean();

    res.json({
        success: true,
        data: { notes: notes.map(formatCrmNote) },
    });
});

/** POST /studio/crm/notes */
const createCrmNote = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const { customer_id, typ, inhalt, aufgabe } = req.body;

    const customer = await assertCustomerInStudio(customer_id, studioId);

    const note = await CrmNote.create({
        studio: studioId,
        customer: customer_id,
        typ,
        inhalt,
        erstellt_von: req.user._id,
    });

    let task = null;
    if (aufgabe?.titel) {
        const faelligDate = aufgabe.faellig_am
            ? new Date(aufgabe.faellig_am)
            : new Date(Date.now() + 7 * 86400000);
        if (Number.isNaN(faelligDate.getTime())) {
            throw new ApiError(400, 'Invalid aufgabe.faellig_am date');
        }
        task = await CrmTask.create({
            studio: studioId,
            customer: customer_id,
            titel: aufgabe.titel,
            typ: aufgabe.typ,
            prioritaet: aufgabe.prioritaet,
            faellig_am: faelligDate,
            erstellt_von: req.user._id,
        });
    }

    await note.populate('customer', 'vorname nachname');

    res.status(201).json({
        success: true,
        data: {
            note: formatCrmNote(note.toObject()),
            task: task ? formatCrmTask({ ...task.toObject(), customer }) : null,
        },
    });
});

/** GET /studio/crm/templates/:customerId */
const getCrmTemplate = asyncHandler(async (req, res) => {
    const studioId = resolveStudioId(req);
    const customer = await assertCustomerInStudio(req.params.customerId, studioId);

    const faelleGesamt = await Case.countDocuments({ customer: customer._id });

    res.json({
        success: true,
        data: {
            pipeline_stufe: customer.pipeline_stufe,
            aktion: getStageAktion(customer.pipeline_stufe, faelleGesamt),
            template_text: getLeadTemplate(customer.pipeline_stufe, customer.vorname, faelleGesamt),
        },
    });
});

module.exports = {
    getCrmPipeline,
    listCrmTasks,
    createCrmTask,
    updateCrmTask,
    deleteCrmTask,
    listCrmNotes,
    createCrmNote,
    getCrmTemplate,
};

const StudioTransferRequest = require('../models/studioTransferRequestModel');
const Customer = require('../models/customerModel');
const Studio = require('../models/studioModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { isCustomer, isStudio, isAdmin, refId } = require('../utils/accessHelpers');
const {
    STUDIO_TRANSFER_STATUS,
    STUDIO_STATUS,
    AKQUISE_QUELLE,
} = require('../config/constants');

const formatTransfer = (doc, { includeSignature = false, studioNames = {} } = {}) => {
    const t = doc.toObject ? doc.toObject() : doc;
    const vonId = refId(t.von_firma_id);
    const zuId = refId(t.zu_firma_id);
    const payload = {
        id: t._id,
        customer_id: t.customer?._id ?? t.customer,
        kunde_name: t.kunde_name ?? '',
        von_firma_id: vonId,
        von_firma_name: t.von_firma_name || studioNames[vonId] || '',
        zu_firma_id: zuId,
        zu_firma_name: t.zu_firma_name || studioNames[zuId] || '',
        status: t.status,
        einwilligung_akte: !!t.einwilligung_akte,
        einwilligung_datenschutz: !!t.einwilligung_datenschutz,
        einwilligung_bestaetigung: !!t.einwilligung_bestaetigung,
        einwilligung_datum: t.einwilligung_datum,
        has_signature: !!(t.einwilligung_unterschrift && String(t.einwilligung_unterschrift).length),
        ablehnungsgrund: t.ablehnungsgrund || '',
        bearbeitet_am: t.bearbeitet_am,
        genehmigt_am: t.genehmigt_am,
        genehmigt_von: t.genehmigt_von || '',
        erstellt_am: t.createdAt,
    };
    if (includeSignature) {
        payload.einwilligung_unterschrift = t.einwilligung_unterschrift || '';
    }
    return payload;
};

const actorLabel = (user) => {
    if (isAdmin(user.role)) return `Admin (${user.email || user._id})`;
    if (isStudio(user.role)) return `Studio (${user.email || user._id})`;
    return user.email || String(user._id);
};

const resolveStudioNames = async (rows) => {
    const ids = new Set();
    for (const row of rows) {
        const vonId = refId(row.von_firma_id);
        const zuId = refId(row.zu_firma_id);
        if (vonId && !row.von_firma_name) ids.add(vonId);
        if (zuId && !row.zu_firma_name) ids.add(zuId);
    }
    if (!ids.size) return {};

    const studios = await Studio.find({ _id: { $in: [...ids] } }).select('firma').lean();
    return Object.fromEntries(studios.map((s) => [s._id.toString(), s.firma ?? '']));
};

/** When customer joined the source studio (from firma_history) */
const resolveSourceJoinDates = async (rows) => {
    const customerIds = [...new Set(rows.map((r) => refId(r.customer)).filter(Boolean))];
    if (!customerIds.length) return {};

    const customers = await Customer.find({ _id: { $in: customerIds } })
        .select('firma_history createdAt')
        .lean();

    const dates = {};
    for (const customer of customers) {
        const cid = customer._id.toString();
        for (const entry of customer.firma_history || []) {
            const sid = refId(entry.firma_id);
            if (sid && entry.von) {
                dates[`${cid}:${sid}`] = entry.von;
            }
        }
    }
    return dates;
};

/** Apply customer studio change + history + akquise on approve */
const applyTransferApproval = async (request, user) => {
    const customer = await Customer.findById(request.customer);
    if (!customer) throw new ApiError(404, 'Customer not found');

    const now = new Date();
    const fromId = request.von_firma_id.toString();
    const toId = request.zu_firma_id.toString();

    // Close open history entry for current studio
    for (const entry of customer.firma_history || []) {
        if (
            entry.firma_id?.toString() === fromId &&
            (entry.bis === null || entry.bis === undefined)
        ) {
            entry.bis = now;
            if (!entry.grund) entry.grund = 'studio_wechsel';
        }
    }

    customer.firma_history.push({
        firma_id: request.zu_firma_id,
        von: now,
        bis: null,
        grund: 'studio_wechsel',
    });

    customer.aktuelle_firma_id = request.zu_firma_id;
    customer.akquise_quelle = AKQUISE_QUELLE.STUDIO_WECHSEL;
    customer.markModified('firma_history');
    await customer.save();

    request.status = STUDIO_TRANSFER_STATUS.GENEHMIGT;
    request.bearbeitet_am = now;
    request.genehmigt_am = now;
    request.genehmigt_von = actorLabel(user);
    request.bearbeitet_von_user = user._id;
    await request.save();

    return customer;
};

/** POST /studio-transfers — customer creates transfer request */
const createTransfer = asyncHandler(async (req, res) => {
    if (!isCustomer(req.user.role) || !req.user.customer_id) {
        throw new ApiError(403, 'Only customers can request a studio transfer');
    }

    const customer = await Customer.findById(req.user.customer_id);
    if (!customer) throw new ApiError(404, 'Customer not found');

    const pending = await StudioTransferRequest.findOne({
        customer: customer._id,
        status: STUDIO_TRANSFER_STATUS.AUSSTEHEND,
    });
    if (pending) {
        throw new ApiError(409, 'You already have a pending studio transfer request');
    }

    const { zu_firma_id, einwilligung_unterschrift } = req.body;
    if (customer.aktuelle_firma_id.toString() === zu_firma_id) {
        throw new ApiError(400, 'Cannot transfer to your current studio');
    }

    const [fromStudio, toStudio] = await Promise.all([
        Studio.findById(customer.aktuelle_firma_id).select('firma status').lean(),
        Studio.findById(zu_firma_id).select('firma status').lean(),
    ]);

    if (!toStudio) throw new ApiError(404, 'Target studio not found');
    if (toStudio.status !== STUDIO_STATUS.AKTIV) {
        throw new ApiError(400, 'Target studio is not active');
    }

    const now = new Date();
    const request = await StudioTransferRequest.create({
        customer: customer._id,
        kunde_name: `${customer.vorname ?? ''} ${customer.nachname ?? ''}`.trim(),
        von_firma_id: customer.aktuelle_firma_id,
        von_firma_name: fromStudio?.firma ?? '',
        zu_firma_id: toStudio._id,
        zu_firma_name: toStudio.firma ?? '',
        status: STUDIO_TRANSFER_STATUS.AUSSTEHEND,
        einwilligung_akte: true,
        einwilligung_datenschutz: true,
        einwilligung_bestaetigung: true,
        einwilligung_unterschrift,
        einwilligung_datum: now,
    });

    res.status(201).json({
        success: true,
        message: 'Studio transfer request submitted',
        data: { transfer: formatTransfer(request) },
    });
});

/** GET /studio-transfers/me — customer's own requests */
const listMyTransfers = asyncHandler(async (req, res) => {
    if (!isCustomer(req.user.role) || !req.user.customer_id) {
        throw new ApiError(403, 'Only customers can list their transfer requests');
    }

    const { page, limit, skip } = parsePagination(req.query);
    const filter = { customer: req.user.customer_id };
    if (req.query.status) filter.status = req.query.status;

    const [rows, total] = await Promise.all([
        StudioTransferRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        StudioTransferRequest.countDocuments(filter),
    ]);

    res.json({
        success: true,
        data: {
            transfers: rows.map((r) => formatTransfer(r)),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** GET /studio-transfers — inbound + outbound for studio, all for admin */
const listTransfers = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    if (isStudio(req.user.role)) {
        if (!req.user.studio_id) throw new ApiError(400, 'Studio assignment required');
        const studioId = req.user.studio_id;
        filter.$or = [{ zu_firma_id: studioId }, { von_firma_id: studioId }];
    } else if (!isAdmin(req.user.role)) {
        throw new ApiError(403, 'You do not have permission to list transfer requests');
    }

    if (req.query.status) filter.status = req.query.status;

    const viewerStudioId = isStudio(req.user.role) ? refId(req.user.studio_id) : null;

    const [rows, total] = await Promise.all([
        StudioTransferRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        StudioTransferRequest.countDocuments(filter),
    ]);

    const studioNames = await resolveStudioNames(rows);
    const sourceJoinDates = await resolveSourceJoinDates(rows);

    res.json({
        success: true,
        data: {
            transfers: rows.map((r) => {
                const transfer = formatTransfer(r, { studioNames });
                const customerId = refId(r.customer);
                const sourceId = refId(r.von_firma_id);
                transfer.beitritt_quelle_am = sourceJoinDates[`${customerId}:${sourceId}`] ?? null;
                transfer.wechsel_genehmigt_am = r.genehmigt_am ?? null;
                if (viewerStudioId) {
                    transfer.richtung =
                        refId(r.zu_firma_id) === viewerStudioId ? 'eingehend' : 'ausgehend';
                }
                return transfer;
            }),
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

/** GET /studio-transfers/:id */
const getTransfer = asyncHandler(async (req, res) => {
    const request = await StudioTransferRequest.findById(req.params.id);
    if (!request) throw new ApiError(404, 'Transfer request not found');

    const isOwner =
        isCustomer(req.user.role) &&
        request.customer.toString() === req.user.customer_id?.toString();
    const isTargetStudio =
        isStudio(req.user.role) &&
        request.zu_firma_id.toString() === req.user.studio_id?.toString();
    const isSourceStudio =
        isStudio(req.user.role) &&
        request.von_firma_id.toString() === req.user.studio_id?.toString();

    if (!isOwner && !isTargetStudio && !isSourceStudio && !isAdmin(req.user.role)) {
        throw new ApiError(403, 'You do not have access to this transfer request');
    }

    res.json({
        success: true,
        data: {
            transfer: formatTransfer(request, {
                includeSignature: isTargetStudio || isAdmin(req.user.role),
            }),
        },
    });
});

/** PATCH /studio-transfers/:id/approve — Elaya admin / super_admin only (handoff §10.15) */
const approveTransfer = asyncHandler(async (req, res) => {
    const request = await StudioTransferRequest.findById(req.params.id);
    if (!request) throw new ApiError(404, 'Transfer request not found');
    if (request.status !== STUDIO_TRANSFER_STATUS.AUSSTEHEND) {
        throw new ApiError(400, 'Transfer request is not pending');
    }

    if (!isAdmin(req.user.role)) {
        throw new ApiError(403, 'Only Elaya platform admin can approve studio transfers');
    }

    // Re-check customer is still at source studio
    const customer = await Customer.findById(request.customer).select('aktuelle_firma_id');
    if (!customer) throw new ApiError(404, 'Customer not found');
    if (customer.aktuelle_firma_id.toString() !== request.von_firma_id.toString()) {
        throw new ApiError(409, 'Customer studio has changed since this request was created');
    }

    await applyTransferApproval(request, req.user);

    res.json({
        success: true,
        message: 'Studio transfer approved',
        data: { transfer: formatTransfer(request) },
    });
});

/** PATCH /studio-transfers/:id/reject — Elaya admin / super_admin only (handoff §10.15) */
const rejectTransfer = asyncHandler(async (req, res) => {
    const request = await StudioTransferRequest.findById(req.params.id);
    if (!request) throw new ApiError(404, 'Transfer request not found');
    if (request.status !== STUDIO_TRANSFER_STATUS.AUSSTEHEND) {
        throw new ApiError(400, 'Transfer request is not pending');
    }

    if (!isAdmin(req.user.role)) {
        throw new ApiError(403, 'Only Elaya platform admin can reject studio transfers');
    }

    request.status = STUDIO_TRANSFER_STATUS.ABGELEHNT;
    request.ablehnungsgrund = req.body.ablehnungsgrund;
    request.bearbeitet_am = new Date();
    request.bearbeitet_von_user = req.user._id;
    request.genehmigt_von = actorLabel(req.user);
    await request.save();

    res.json({
        success: true,
        message: 'Studio transfer rejected',
        data: { transfer: formatTransfer(request) },
    });
});

module.exports = {
    createTransfer,
    listMyTransfers,
    listTransfers,
    getTransfer,
    approveTransfer,
    rejectTransfer,
};

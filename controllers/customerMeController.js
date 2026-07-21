const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const StudioTransferRequest = require('../models/studioTransferRequestModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { isCustomer } = require('../utils/accessHelpers');
const { STUDIO_TRANSFER_STATUS } = require('../config/constants');
const {
    formatFirmaTimeline,
    formatCustomerProfileForMe,
} = require('../utils/customerProfileHelpers');

const assertCustomerUser = (user) => {
    if (!isCustomer(user.role) || !user.customer_id) {
        throw new ApiError(403, 'Only customer accounts can access this endpoint');
    }
};

const loadOwnCustomer = async (user, { populateStudio = true } = {}) => {
    assertCustomerUser(user);

    let query = Customer.findById(user.customer_id).select('-elaycoins.transactions');
    if (populateStudio) {
        query = query.populate({ path: 'aktuelle_firma_id', select: 'firma studio_code ort' });
    }
    const customer = await query.lean();
    if (!customer) {
        throw new ApiError(404, 'Customer profile not found');
    }
    return customer;
};

const setJsonDownloadHeaders = (res, filename) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
};

// ── PATCH /customers/me ───────────────────────────────────────────────────
const updateMe = asyncHandler(async (req, res) => {
    assertCustomerUser(req.user);

    const customer = await Customer.findById(req.user.customer_id);
    if (!customer) {
        throw new ApiError(404, 'Customer profile not found');
    }

    const editable = [
        'vorname',
        'nachname',
        'telefon',
        'geburtsdatum',
        'strasse',
        'plz',
        'ort',
        'land',
    ];

    editable.forEach((field) => {
        if (req.body[field] !== undefined) {
            customer[field] = req.body[field];
        }
    });

    if (req.body.email !== undefined) {
        const email = String(req.body.email).trim().toLowerCase();
        const existing = await User.findOne({
            email,
            _id: { $ne: customer.user },
        });
        if (existing) {
            throw new ApiError(409, 'A user with this email already exists');
        }
        customer.email = email;
        await User.findByIdAndUpdate(customer.user, { email });
    }

    await customer.save();

    const populated = await Customer.findById(customer._id)
        .select('-elaycoins.transactions')
        .populate({ path: 'aktuelle_firma_id', select: 'firma studio_code ort' })
        .lean();

    const profile = await formatCustomerProfileForMe(populated);

    res.json({
        success: true,
        message: 'Profile updated',
        data: { profile },
    });
});

// ── GET /customers/me/export ──────────────────────────────────────────────
const exportMe = asyncHandler(async (req, res) => {
    const customer = await loadOwnCustomer(req.user, { populateStudio: true });
    const customerId = customer._id;

    const [cases, sessionCounts, appointmentCounts, firma_timeline] = await Promise.all([
        Case.find({ customer: customerId })
            .select('caseId type tc_title status sessions sessionsDone removal bodyLabel studio')
            .sort({ createdAt: -1 })
            .lean(),
        Session.aggregate([
            { $match: { customer: customerId } },
            { $group: { _id: '$case', count: { $sum: 1 } } },
        ]),
        Appointment.aggregate([
            { $match: { customer: customerId } },
            { $group: { _id: '$case', count: { $sum: 1 } } },
        ]),
        formatFirmaTimeline(customer.firma_history ?? []),
    ]);

    const sessionsByCase = Object.fromEntries(
        sessionCounts.map((row) => [String(row._id), row.count])
    );
    const appointmentsByCase = Object.fromEntries(
        appointmentCounts.map((row) => [String(row._id), row.count])
    );

    const studioEmbed = customer.aktuelle_firma_id;
    const exportData = {
        exportiert_am: new Date().toISOString(),
        benutzer: {
            id: String(customerId),
            vorname: customer.vorname,
            nachname: customer.nachname,
            email: customer.email,
            telefon: customer.telefon,
            geburtsdatum: customer.geburtsdatum,
            strasse: customer.strasse,
            plz: customer.plz,
            ort: customer.ort,
            land: customer.land,
            registriert_am: customer.registriert_am,
            aktuelle_firma: studioEmbed && typeof studioEmbed === 'object'
                ? {
                      id: String(studioEmbed._id),
                      firma: studioEmbed.firma,
                      studio_code: studioEmbed.studio_code,
                      ort: studioEmbed.ort,
                  }
                : null,
        },
        cases: cases.map((c) => {
            const caseId = String(c._id);
            const sessionCount = sessionsByCase[caseId] ?? c.sessionsDone ?? 0;
            const appointmentCount = appointmentsByCase[caseId] ?? 0;
            return {
                id: caseId,
                caseId: c.caseId,
                type: c.type,
                tc_title: c.tc_title,
                koerperstelle: c.bodyLabel ?? '',
                bodyLabel: c.bodyLabel ?? '',
                status: c.status,
                sessions: c.sessions,
                sessionsDone: c.sessionsDone,
                removal: c.removal,
                behandlungen: `${sessionCount} Sitzungen`,
                termine: `${appointmentCount} Termine`,
            };
        }),
        studio_history: firma_timeline,
        elaycoins: {
            balance: customer.elaycoins?.balance ?? 0,
        },
    };

    const dateStamp = new Date().toISOString().slice(0, 10);
    setJsonDownloadHeaders(res, `elaya-meine-daten-${dateStamp}.json`);

    res.status(200).json(exportData);
});

// ── GET /customers/me/transfer-protocol ───────────────────────────────────
const exportTransferProtocol = asyncHandler(async (req, res) => {
    assertCustomerUser(req.user);

    const transfer = await StudioTransferRequest.findOne({
        customer: req.user.customer_id,
        status: STUDIO_TRANSFER_STATUS.GENEHMIGT,
    })
        .sort({ genehmigt_am: -1, createdAt: -1 })
        .lean();

    if (!transfer) {
        throw new ApiError(
            404,
            'No approved studio transfer found — protocol available after admin approval'
        );
    }

    const Studio = require('../models/studioModel');
    const [vonStudio, zuStudio] = await Promise.all([
        Studio.findById(transfer.von_firma_id).select('firma').lean(),
        Studio.findById(transfer.zu_firma_id).select('firma').lean(),
    ]);

    const protocol = {
        exportiert_am: new Date().toISOString(),
        typ: 'datentransfer_protokoll',
        anfrage_id: String(transfer._id),
        kunde: {
            id: String(req.user.customer_id),
            name: transfer.kunde_name,
        },
        von_studio: {
            id: String(transfer.von_firma_id),
            name: transfer.von_firma_name || vonStudio?.firma || '',
        },
        zu_studio: {
            id: String(transfer.zu_firma_id),
            name: transfer.zu_firma_name || zuStudio?.firma || '',
        },
        status: transfer.status,
        einwilligung_datum: transfer.einwilligung_datum,
        genehmigt_am: transfer.genehmigt_am,
        genehmigt_von: transfer.genehmigt_von || null,
        einwilligungen: {
            akte: transfer.einwilligung_akte,
            datenschutz: transfer.einwilligung_datenschutz,
            bestaetigung: transfer.einwilligung_bestaetigung,
            unterschrift_vorhanden: Boolean(transfer.einwilligung_unterschrift),
        },
        shared_case_layer: {
            beschreibung:
                'Medizinische Behandlungshistorie (Fälle, Sitzungen, Anamnese, Fotos) wurde an das neue Studio übertragen. Elaycoins verbleiben beim Kunden.',
            uebertragene_daten: [
                'Fälle und Fallstatus',
                'Sitzungsprotokolle und Verblassung',
                'Medizinische Anamnese',
                'Aufnahmefotos',
                'Terminhistorie',
            ],
            nicht_uebertragen: [
                'Interne Studio-Preise',
                'Interne Studio-Notizen',
                'Elaya-Transaktionsgebühren',
            ],
        },
    };

    const dateStamp = new Date().toISOString().slice(0, 10);
    setJsonDownloadHeaders(res, `elaya-datentransfer-protokoll-${dateStamp}.json`);

    res.status(200).json(protocol);
});

module.exports = {
    updateMe,
    exportMe,
    exportTransferProtocol,
};

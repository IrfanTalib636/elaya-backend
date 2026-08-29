const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const Anamnesis = require('../models/anamnesisModel');
const ShopOrder = require('../models/shopOrderModel');
const StudioTransferRequest = require('../models/studioTransferRequestModel');
const Studio = require('../models/studioModel');
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

const loadOwnCustomer = async (user, { populateStudio = true, includeCoinTx = false } = {}) => {
    assertCustomerUser(user);

    const select = includeCoinTx ? '-__v' : '-elaycoins.transactions -__v';
    let query = Customer.findById(user.customer_id).select(select);
    if (populateStudio) {
        query = query.populate({ path: 'aktuelle_firma_id', select: 'firma studio_code ort' });
    }
    const customer = await query.lean();
    if (!customer) {
        throw new ApiError(404, 'Customer profile not found');
    }
    return customer;
};

/** Safe filename fragment from customer name, e.g. Jin_dummy */
const buildCustomerFilenameStem = (vorname, nachname) => {
    const raw = [vorname, nachname]
        .filter(Boolean)
        .join('_')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
    return raw || 'Kunde';
};

const setJsonDownloadHeaders = (res, filename) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // Always fresh — never serve a cached export
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
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
/**
 * DSG / GDPR data export — built live from MongoDB on every request (no cache).
 * Includes all customer-owned data; excludes studio-internal fields (laser params,
 * internal prices, studio notes, klaerung audit).
 */
const exportMe = asyncHandler(async (req, res) => {
    // Always re-read from DB — never reuse a previous export snapshot
    const customer = await loadOwnCustomer(req.user, {
        populateStudio: true,
        includeCoinTx: true,
    });
    const customerId = customer._id;
    const exportiert_am = new Date().toISOString();

    const cases = await Case.find({ customer: customerId })
        .select(
            [
                'caseId',
                'type',
                'status',
                'tc_title',
                'bodyLabel',
                'sessions',
                'sessionsDone',
                'removal',
                'lastSessionDate',
                'medical_flag_level',
                'anamnesis_complete',
                'goal_target',
                'skin_fitzpatrick',
                'skin_fitzpatrick_type',
                'tc_colors_present',
                'tc_size_length',
                'tc_size_width',
                'tc_age_years',
                'tc_type',
                'tc_coverup',
                'zonen_aktiv',
                'pmu_type',
                'pmu_side',
                'pmu_age_range',
                'pmu_technique',
                'colors',
                'photo_intake_main',
                'photo_intake_detail',
                'photo_marker',
                'unterschrift.zeitstempel',
                'unterschrift.merkblatt_gelesen',
                'createdAt',
                'updatedAt',
            ].join(' ')
        )
        .sort({ createdAt: -1 })
        .lean();

    const caseIds = cases.map((c) => c._id);

    const [
        sessions,
        appointments,
        anamneses,
        zones,
        shopOrders,
        transfers,
        firma_timeline,
    ] = await Promise.all([
            Session.find({ customer: customerId })
                .select(
                    'case session_number treatment_date treatment_time removal_pct verblassung_prozent comparison_eligible uncertainty_level progress_direction is_draft is_no_show standort_name createdAt'
                )
                .sort({ treatment_date: -1 })
                .lean(),
            Appointment.find({ customer: customerId })
                .select(
                    'case date time status type consultationOnly standort_name gruppen_termin dauer_minuten createdAt'
                )
                .sort({ date: -1 })
                .lean(),
            caseIds.length
                ? Anamnesis.find({ case: { $in: caseIds } })
                      .select('case ampel_status orange_fragen rote_fragen antworten createdAt updatedAt')
                      .lean()
                : Promise.resolve([]),
            // Zones live in their own collection, so they have to be fetched
            // separately — selecting `zonen` off the Case yields nothing.
            caseIds.length
                ? CaseZone.find({ case: { $in: caseIds } })
                      .select(
                          'case zonen_id bezeichnung koerperstelle farben dichte laenge_cm breite_cm flaeche_cm2 foto_url preis sitzungen_geschaetzt_min sitzungen_geschaetzt_max fortschritt_prozent createdAt'
                      )
                      .sort({ zonen_id: 1 })
                      .lean()
                : Promise.resolve([]),
            ShopOrder.find({ customer: customerId })
                .select(
                    'order_number produkte total_chf versandkosten status lieferadresse zahlungsart createdAt'
                )
                .sort({ createdAt: -1 })
                .lean(),
            StudioTransferRequest.find({ customer: customerId })
                .select(
                    'von_firma_id von_firma_name zu_firma_id zu_firma_name status einwilligung_akte einwilligung_datenschutz einwilligung_bestaetigung einwilligung_unterschrift einwilligung_datum ablehnungsgrund genehmigt_am genehmigt_von createdAt'
                )
                .sort({ createdAt: -1 })
                .lean(),
            formatFirmaTimeline(customer.firma_history ?? []),
        ]);

    const studioEmbed = customer.aktuelle_firma_id;
    const anamnesisByCase = Object.fromEntries(
        anamneses.map((a) => [String(a.case), a])
    );
    const zonesByCase = zones.reduce((acc, zone) => {
        const key = String(zone.case);
        (acc[key] ??= []).push(zone);
        return acc;
    }, {});

    const exportData = {
        exportiert_am,
        hinweis:
            'Dieses File wurde live aus der Elaya-Datenbank erzeugt (kein Cache). Es enthält Ihre Kundendaten gemäss Auskunftsrecht (DSG/DSGVO). Studio-interne Laserparameter, interne Preise und Studio-Notizen sind nicht enthalten.',
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
            pipeline_stufe: customer.pipeline_stufe,
            akquise_quelle: customer.akquise_quelle,
            aktuelle_firma:
                studioEmbed && typeof studioEmbed === 'object'
                    ? {
                          id: String(studioEmbed._id),
                          firma: studioEmbed.firma,
                          studio_code: studioEmbed.studio_code,
                          ort: studioEmbed.ort,
                      }
                    : null,
        },
        studio_history: firma_timeline,
        cases: cases.map((c) => {
            const caseId = String(c._id);
            const anam = anamnesisByCase[caseId];
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
                lastSessionDate: c.lastSessionDate ?? null,
                medical_flag_level: c.medical_flag_level ?? null,
                anamnesis_complete: !!c.anamnesis_complete,
                goal_target: c.goal_target ?? null,
                intake: {
                    skin_fitzpatrick: c.skin_fitzpatrick ?? c.skin_fitzpatrick_type ?? null,
                    tc_colors_present: c.tc_colors_present ?? null,
                    tc_size_length: c.tc_size_length ?? null,
                    tc_size_width: c.tc_size_width ?? null,
                    tc_age_years: c.tc_age_years ?? null,
                    tc_type: c.tc_type ?? null,
                    tc_coverup: c.tc_coverup ?? null,
                    zonen_aktiv: c.zonen_aktiv ?? false,
                    zonen: zonesByCase[String(c._id)] ?? [],
                    pmu_type: c.pmu_type ?? null,
                    pmu_side: c.pmu_side ?? null,
                    pmu_age_range: c.pmu_age_range ?? null,
                    pmu_technique: c.pmu_technique ?? null,
                    colors: c.colors ?? [],
                },
                photos: {
                    photo_intake_main: c.photo_intake_main || null,
                    photo_intake_detail: c.photo_intake_detail || null,
                    photo_marker: c.photo_marker || null,
                },
                unterschrift: c.unterschrift
                    ? {
                          zeitstempel: c.unterschrift.zeitstempel ?? null,
                          merkblatt_gelesen: !!c.unterschrift.merkblatt_gelesen,
                      }
                    : null,
                anamnese: anam
                    ? {
                          ampel_status: anam.ampel_status,
                          orange_fragen: anam.orange_fragen ?? [],
                          rote_fragen: anam.rote_fragen ?? [],
                          antworten: anam.antworten ?? {},
                          aktualisiert_am: anam.updatedAt ?? null,
                      }
                    : null,
                createdAt: c.createdAt,
                updatedAt: c.updatedAt,
            };
        }),
        sitzungen: sessions.map((s) => ({
            id: String(s._id),
            case_id: String(s.case),
            session_number: s.session_number,
            treatment_date: s.treatment_date,
            treatment_time: s.treatment_time,
            standort_name: s.standort_name ?? '',
            removal_pct: s.comparison_eligible === false ? null : s.removal_pct,
            verblassung_prozent: s.comparison_eligible === false ? null : s.verblassung_prozent,
            comparison_eligible: s.comparison_eligible ?? null,
            uncertainty_level: s.uncertainty_level ?? null,
            progress_direction: s.comparison_eligible === false ? 'unclear' : s.progress_direction ?? null,
            is_no_show: !!s.is_no_show,
            is_draft: !!s.is_draft,
        })),
        termine: appointments.map((a) => ({
            id: String(a._id),
            case_id: String(a.case),
            date: a.date,
            time: a.time,
            status: a.status,
            type: a.type,
            consultationOnly: !!a.consultationOnly,
            standort_name: a.standort_name ?? '',
            gruppen_termin: !!a.gruppen_termin,
            dauer_minuten: a.dauer_minuten,
        })),
        elaycoins: {
            balance: customer.elaycoins?.balance ?? 0,
            transactions: (customer.elaycoins?.transactions ?? []).map((t) => ({
                situationKey: t.situationKey,
                label: t.label,
                kat: t.kat,
                coins: t.coins,
                typ: t.typ,
                datum: t.datum,
            })),
        },
        shop_bestellungen: shopOrders.map((o) => ({
            id: String(o._id),
            order_number: o.order_number,
            produkte: o.produkte ?? [],
            total_chf: o.total_chf,
            versandkosten: o.versandkosten,
            status: o.status,
            lieferadresse: o.lieferadresse,
            zahlungsart: o.zahlungsart,
            bestellt_am: o.createdAt,
        })),
        studio_transfers: transfers.map((t) => ({
            id: String(t._id),
            von_studio: {
                id: String(t.von_firma_id),
                name: t.von_firma_name || '',
            },
            zu_studio: {
                id: String(t.zu_firma_id),
                name: t.zu_firma_name || '',
            },
            status: t.status,
            einwilligung_datum: t.einwilligung_datum,
            genehmigt_am: t.genehmigt_am,
            genehmigt_von: t.genehmigt_von || null,
            ablehnungsgrund: t.ablehnungsgrund || null,
            einwilligungen: {
                akte: !!t.einwilligung_akte,
                datenschutz: !!t.einwilligung_datenschutz,
                bestaetigung: !!t.einwilligung_bestaetigung,
                unterschrift_vorhanden: Boolean(t.einwilligung_unterschrift),
            },
            erstellt_am: t.createdAt,
        })),
    };

    const missingStudioIds = [
        ...new Set(
            exportData.studio_transfers
                .flatMap((t) => [
                    !t.von_studio.name ? t.von_studio.id : null,
                    !t.zu_studio.name ? t.zu_studio.id : null,
                ])
                .filter(Boolean)
        ),
    ];
    if (missingStudioIds.length) {
        const studios = await Studio.find({ _id: { $in: missingStudioIds } })
            .select('firma')
            .lean();
        const nameById = Object.fromEntries(studios.map((s) => [String(s._id), s.firma ?? '']));
        exportData.studio_transfers.forEach((t) => {
            if (!t.von_studio.name) t.von_studio.name = nameById[t.von_studio.id] || '';
            if (!t.zu_studio.name) t.zu_studio.name = nameById[t.zu_studio.id] || '';
        });
    }

    const dateStamp = exportiert_am.slice(0, 10);
    const nameStem = buildCustomerFilenameStem(customer.vorname, customer.nachname);
    setJsonDownloadHeaders(res, `${nameStem}_Meine-Daten_${dateStamp}.json`);

    res.status(200).json(exportData);
});

// ── GET /customers/me/transfer-protocol ───────────────────────────────────
const exportTransferProtocol = asyncHandler(async (req, res) => {
    assertCustomerUser(req.user);

    const customer = await Customer.findById(req.user.customer_id)
        .select('vorname nachname')
        .lean();

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
            name: transfer.kunde_name || `${customer?.vorname ?? ''} ${customer?.nachname ?? ''}`.trim(),
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
    const nameStem = buildCustomerFilenameStem(customer?.vorname, customer?.nachname);
    setJsonDownloadHeaders(res, `${nameStem}_Datentransfer-Protokoll_${dateStamp}.json`);

    res.status(200).json(protocol);
});

module.exports = {
    updateMe,
    exportMe,
    exportTransferProtocol,
};

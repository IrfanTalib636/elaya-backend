const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const {
    PlatformDocument,
    DOCUMENT_CATEGORIES,
    DOCUMENT_SCOPES,
    DOCUMENT_VISIBILITY,
} = require('../models/platformDocumentModel');
const Studio = require('../models/studioModel');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

const SEED_DOCS = [
    {
        code: 'dok_001',
        kategorie: 'merkblatt',
        titel_de: 'Nachsorge nach der Behandlung',
        titel_en: 'Aftercare after treatment',
        inhalt_de:
            'Bitte befolgen Sie die Nachsorgehinweise: Kühlung, Sonnenschutz, keine Sauna/Solarium in den ersten Tagen.',
        inhalt_en:
            'Please follow aftercare guidance: cooling, sun protection, no sauna/tanning bed in the first days.',
        geltungsbereich: 'global',
        sichtbar_in: ['customer_app', 'studio_dashboard'],
        aktiv: true,
        version: 1,
        geaendert_von: 'System',
    },
    {
        code: 'dok_002',
        kategorie: 'einwilligung',
        titel_de: 'Einwilligung zur Laserbehandlung',
        titel_en: 'Consent to laser treatment',
        inhalt_de:
            'Ich willige in die geplante Laserbehandlung ein und bestätige, dass ich über Risiken und Alternativen aufgeklärt wurde.',
        inhalt_en:
            'I consent to the planned laser treatment and confirm that I have been informed about risks and alternatives.',
        geltungsbereich: 'global',
        sichtbar_in: ['customer_app', 'studio_dashboard'],
        aktiv: true,
        version: 1,
        geaendert_von: 'System',
    },
    {
        code: 'dok_003',
        kategorie: 'faq',
        titel_de: 'Häufige Fragen zur Tattooentfernung',
        titel_en: 'FAQ about tattoo removal',
        inhalt_de:
            'Wie viele Sitzungen brauche ich? Das hängt von Farbe, Tiefe und Lifestyle ab — die Engine liefert eine Prognose.',
        inhalt_en:
            'How many sessions do I need? It depends on colour, depth and lifestyle — the engine provides a forecast.',
        geltungsbereich: 'global',
        sichtbar_in: ['customer_app'],
        aktiv: true,
        version: 1,
        geaendert_von: 'System',
    },
];

const actorLabel = (user) => {
    if (!user) return 'Admin';
    return user.name || user.email || 'Admin';
};

const formatDoc = (doc) => {
    const d = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(d._id),
        code: d.code,
        kategorie: d.kategorie,
        titel_de: d.titel_de || '',
        titel_en: d.titel_en || '',
        inhalt_de: d.inhalt_de || '',
        inhalt_en: d.inhalt_en || '',
        geltungsbereich: d.geltungsbereich || 'global',
        zugewiesene_studios: (d.zugewiesene_studios || []).map((s) => {
            if (s && typeof s === 'object') {
                return {
                    id: String(s._id || s.id),
                    firma: s.firma || '',
                    studio_code: s.studio_code || '',
                };
            }
            return { id: String(s), firma: '', studio_code: '' };
        }),
        sichtbar_in: Array.isArray(d.sichtbar_in) ? d.sichtbar_in : [],
        aktiv: d.aktiv !== false,
        version: d.version || 1,
        geaendert_von: d.geaendert_von || '',
        erstellt_am: d.createdAt,
        geaendert_am: d.updatedAt,
    };
};

const nextDokCode = async () => {
    const rows = await PlatformDocument.find({ code: /^dok_\d+$/i })
        .select('code')
        .lean();
    let max = 0;
    for (const row of rows) {
        const m = String(row.code).match(/^dok_(\d+)$/i);
        if (m) max = Math.max(max, Number(m[1]));
    }
    return `dok_${String(max + 1).padStart(3, '0')}`;
};

const seedDocumentsIfEmpty = async () => {
    const count = await PlatformDocument.countDocuments();
    if (count > 0) return { seeded: false, count };
    await PlatformDocument.insertMany(SEED_DOCS);
    return { seeded: true, count: SEED_DOCS.length };
};

const listDocuments = asyncHandler(async (req, res) => {
    await seedDocumentsIfEmpty();

    const { page, limit, skip } = parsePagination(req.query);
    const filter = {};

    if (req.query.kategorie && DOCUMENT_CATEGORIES.includes(req.query.kategorie)) {
        filter.kategorie = req.query.kategorie;
    }
    if (req.query.geltungsbereich && DOCUMENT_SCOPES.includes(req.query.geltungsbereich)) {
        filter.geltungsbereich = req.query.geltungsbereich;
    }
    if (req.query.aktiv === 'true') filter.aktiv = true;
    if (req.query.aktiv === 'false') filter.aktiv = false;
    if (req.query.q) {
        const re = new RegExp(String(req.query.q).trim(), 'i');
        filter.$or = [{ titel_de: re }, { titel_en: re }, { code: re }];
    }

    const [items, total] = await Promise.all([
        PlatformDocument.find(filter)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('zugewiesene_studios', 'firma studio_code')
            .lean(),
        PlatformDocument.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        data: {
            documents: items.map(formatDoc),
            pagination: buildPaginationMeta(page, limit, total),
            meta: {
                categories: DOCUMENT_CATEGORIES,
                scopes: DOCUMENT_SCOPES,
                visibility: DOCUMENT_VISIBILITY,
            },
        },
    });
});

const getDocument = asyncHandler(async (req, res) => {
    const doc = await PlatformDocument.findById(req.params.id).populate(
        'zugewiesene_studios',
        'firma studio_code'
    );
    if (!doc) throw new ApiError(404, 'Document not found');
    res.status(200).json({ success: true, data: { document: formatDoc(doc) } });
});

const normalizePayload = async (body, { isCreate = false } = {}) => {
    const titel_de = String(body.titel_de || '').trim();
    if (!titel_de) throw new ApiError(400, 'titel_de is required');

    const kategorie = String(body.kategorie || '').trim();
    if (!DOCUMENT_CATEGORIES.includes(kategorie)) {
        throw new ApiError(400, 'Invalid kategorie');
    }

    const geltungsbereich = String(body.geltungsbereich || 'global').trim();
    if (!DOCUMENT_SCOPES.includes(geltungsbereich)) {
        throw new ApiError(400, 'Invalid geltungsbereich');
    }

    let studioIds = Array.isArray(body.zugewiesene_studios)
        ? body.zugewiesene_studios.map((s) => String(s?.id || s)).filter(Boolean)
        : [];

    if (geltungsbereich === 'global') {
        studioIds = [];
    } else if (!studioIds.length) {
        throw new ApiError(400, 'Assign at least one studio for studio-specific documents');
    } else {
        const found = await Studio.countDocuments({ _id: { $in: studioIds } });
        if (found !== studioIds.length) {
            throw new ApiError(400, 'One or more studios not found');
        }
    }

    const sichtbar_in = Array.isArray(body.sichtbar_in)
        ? [...new Set(body.sichtbar_in.filter((v) => DOCUMENT_VISIBILITY.includes(v)))]
        : [];

    return {
        kategorie,
        titel_de,
        titel_en: String(body.titel_en || '').trim(),
        inhalt_de: String(body.inhalt_de || '').trim(),
        inhalt_en: String(body.inhalt_en || '').trim(),
        geltungsbereich,
        zugewiesene_studios: studioIds,
        sichtbar_in,
        aktiv: body.aktiv !== false && body.aktiv !== 'false',
        ...(isCreate ? {} : {}),
    };
};

const createDocument = asyncHandler(async (req, res) => {
    const payload = await normalizePayload(req.body, { isCreate: true });
    const code = await nextDokCode();
    const doc = await PlatformDocument.create({
        ...payload,
        code,
        version: 1,
        geaendert_von: actorLabel(req.user),
        created_by: req.user?._id || null,
    });
    const populated = await PlatformDocument.findById(doc._id).populate(
        'zugewiesene_studios',
        'firma studio_code'
    );
    res.status(201).json({ success: true, data: { document: formatDoc(populated) } });
});

const updateDocument = asyncHandler(async (req, res) => {
    const doc = await PlatformDocument.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Document not found');

    const payload = await normalizePayload(req.body);
    Object.assign(doc, payload);
    doc.version = (Number(doc.version) || 1) + 1;
    doc.geaendert_von = actorLabel(req.user);
    await doc.save();

    const populated = await PlatformDocument.findById(doc._id).populate(
        'zugewiesene_studios',
        'firma studio_code'
    );
    res.status(200).json({ success: true, data: { document: formatDoc(populated) } });
});

const toggleDocumentActive = asyncHandler(async (req, res) => {
    const doc = await PlatformDocument.findById(req.params.id);
    if (!doc) throw new ApiError(404, 'Document not found');

    if (typeof req.body.aktiv === 'boolean') {
        doc.aktiv = req.body.aktiv;
    } else {
        doc.aktiv = !doc.aktiv;
    }
    doc.version = (Number(doc.version) || 1) + 1;
    doc.geaendert_von = actorLabel(req.user);
    await doc.save();

    const populated = await PlatformDocument.findById(doc._id).populate(
        'zugewiesene_studios',
        'firma studio_code'
    );
    res.status(200).json({ success: true, data: { document: formatDoc(populated) } });
});

const deleteDocument = asyncHandler(async (req, res) => {
    const doc = await PlatformDocument.findByIdAndDelete(req.params.id);
    if (!doc) throw new ApiError(404, 'Document not found');
    res.status(200).json({ success: true, data: { id: String(doc._id), code: doc.code } });
});

module.exports = {
    listDocuments,
    getDocument,
    createDocument,
    updateDocument,
    toggleDocumentActive,
    deleteDocument,
    seedDocumentsIfEmpty,
};

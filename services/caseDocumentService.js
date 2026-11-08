const fs = require('fs/promises');
const path = require('path');
const Case = require('../models/caseModel');
const Anamnesis = require('../models/anamnesisModel');
const Studio = require('../models/studioModel');
const CaseDocument = require('../models/caseDocumentModel');
const { CASE_DOCUMENT_TYPES } = require('../models/caseDocumentModel');
const { getMerkblattContent } = require('../content/merkblattContent');
const { formatAnamnesisAnswerRows } = require('../utils/anamnesisEngine');
const { buildCaseDocumentPdf, documentTitle } = require('../utils/caseDocumentPdf');
const {
    readSignatureImage,
    isSignatureStoragePath,
    parseSignatureImage,
} = require('../utils/signatureStorage');
const { UPLOAD_ROOT } = require('../config/storageConfig');

const customerDisplayName = (customer) => {
    if (!customer) return '';
    if (typeof customer === 'object') {
        return `${customer.vorname || ''} ${customer.nachname || ''}`.trim() || customer.email || '';
    }
    return '';
};

const loadSignatureBuffer = async (stored) => {
    if (!stored) return null;
    if (typeof stored === 'string' && stored.startsWith('data:image/')) {
        try {
            return parseSignatureImage(stored).buffer;
        } catch {
            return null;
        }
    }
    if (isSignatureStoragePath(stored)) {
        try {
            return await readSignatureImage(stored);
        } catch {
            return null;
        }
    }
    return null;
};

const nextVersion = async (caseId, type) => {
    const latest = await CaseDocument.findOne({ case: caseId, type })
        .sort({ version: -1 })
        .select('version')
        .lean();
    return (latest?.version || 0) + 1;
};

const documentRelativePath = (studioId, caseId, type, version) =>
    path.posix.join(
        studioId.toString(),
        'cases',
        caseId.toString(),
        'documents',
        `${type}-v${version}.pdf`
    );

const writePdf = async (relativePath, buffer) => {
    const absolute = path.join(UPLOAD_ROOT, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, buffer);
};

const formatDocument = (doc) => ({
    id: doc._id.toString(),
    type: doc.type,
    version: doc.version,
    locale: doc.locale,
    title: doc.title,
    status: doc.status,
    signed_at: doc.signed_at,
    size_bytes: doc.size_bytes,
    case: {
        id: doc.case?._id?.toString?.() || doc.case?.toString?.() || String(doc.case),
        caseId: doc.meta?.case_code || doc.case?.caseId || '',
        title: doc.meta?.case_title || doc.case?.tc_title || doc.case?.bodyLabel || '',
    },
    studio: {
        id: doc.studio?._id?.toString?.() || doc.studio?.toString?.() || String(doc.studio),
        name: doc.meta?.studio_name || doc.studio?.name || '',
    },
    customer: {
        id: doc.customer?._id?.toString?.() || doc.customer?.toString?.() || String(doc.customer),
        name: doc.meta?.customer_name || '',
    },
    view_url: `/cases/${doc.case?._id?.toString?.() || doc.case}/documents/${doc._id}/content`,
    download_url: `/cases/${doc.case?._id?.toString?.() || doc.case}/documents/${doc._id}/content?download=1`,
});

/**
 * Create a new versioned PDF for a case document type from current case state.
 */
const createDocumentVersion = async ({
    caseDoc,
    type,
    locale = 'de',
    signedAt = new Date(),
    confirmationText = '',
}) => {
    const loc = locale === 'en' ? 'en' : 'de';
    const customerId = caseDoc.customer?._id || caseDoc.customer;
    const studioId = caseDoc.studio?._id || caseDoc.studio;

    const [studio, anamnesis] = await Promise.all([
        Studio.findById(studioId).select('firma name').lean(),
        type === CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS
            ? Anamnesis.findOne({ case: caseDoc._id }).lean()
            : null,
    ]);

    const customerName = customerDisplayName(caseDoc.customer);
    // Studio display name is `firma` in the schema (legacy `name` kept as fallback).
    const studioName = studio?.firma || studio?.name || '';
    const caseCode = caseDoc.caseId || '';
    const caseTitle = caseDoc.tc_title || caseDoc.bodyLabel || '';
    const version = await nextVersion(caseDoc._id, type);

    let answerRows = [];
    let merkblattSections = [];
    let signatureBuffer = null;
    let confirm = confirmationText;

    if (type === CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS) {
        const answers = anamnesis?.antworten || {};
        answerRows = formatAnamnesisAnswerRows(answers);
        signatureBuffer = await loadSignatureBuffer(
            caseDoc.unterschrift_anamnese?.unterschrift_data
        );
        confirm =
            confirmationText ||
            caseDoc.unterschrift_anamnese?.bestaetigung_text ||
            getMerkblattContent(loc).labels.confirmation_anamnesis_extra;
    } else {
        const content = getMerkblattContent(loc);
        merkblattSections = content.sections || [];
        signatureBuffer = await loadSignatureBuffer(caseDoc.unterschrift?.unterschrift_data);
        confirm =
            confirmationText ||
            caseDoc.unterschrift?.bestaetigung_text ||
            content.labels.confirmation_text;
    }

    const { buffer, contentHash, title } = await buildCaseDocumentPdf({
        type,
        version,
        locale: loc,
        customerName,
        caseCode,
        caseTitle,
        studioName,
        signedAt,
        confirmationText: confirm,
        answerRows,
        merkblattSections,
        signatureBuffer,
    });

    const storagePath = documentRelativePath(studioId, caseDoc._id, type, version);
    await writePdf(storagePath, buffer);

    try {
        const created = await CaseDocument.create({
            case: caseDoc._id,
            customer: customerId,
            studio: studioId,
            type,
            version,
            locale: loc,
            title: `${documentTitle(type, loc)} — Version ${version}`,
            status: 'signed',
            signed_at: signedAt,
            storage_path: storagePath,
            content_hash: contentHash,
            size_bytes: buffer.length,
            meta: {
                case_code: caseCode,
                case_title: caseTitle,
                studio_name: studioName,
                customer_name: customerName,
                confirmation_text: confirm,
            },
        });
        return created;
    } catch (err) {
        // Concurrent backfill/resign race on unique (case, type, version).
        if (err?.code === 11000) {
            const existing = await CaseDocument.findOne({
                case: caseDoc._id,
                type,
                version,
            });
            if (existing) return existing;
        }
        throw err;
    }
};

/**
 * After a successful signature submit: always append new PDF versions (never overwrite).
 */
const recordSignedDocuments = async (caseDoc, { locale = 'de' } = {}) => {
    const loc = locale === 'en' ? 'en' : 'de';
    const created = [];

    if (caseDoc.unterschrift?.zeitstempel) {
        created.push(
            await createDocumentVersion({
                caseDoc,
                type: CASE_DOCUMENT_TYPES.CONSENT_MERKBLATT,
                locale: loc,
                signedAt: caseDoc.unterschrift.zeitstempel,
                confirmationText: caseDoc.unterschrift.bestaetigung_text,
            })
        );
    }

    if (caseDoc.unterschrift_anamnese?.zeitstempel) {
        created.push(
            await createDocumentVersion({
                caseDoc,
                type: CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS,
                locale: loc,
                signedAt: caseDoc.unterschrift_anamnese.zeitstempel,
                confirmationText: caseDoc.unterschrift_anamnese.bestaetigung_text,
            })
        );
    }

    return created;
};

/**
 * Lazy backfill: if the case is signed but has no PDF records yet, create v1 now.
 * Fast no-op when documents already exist.
 */
const ensureCaseDocuments = async (caseId, { locale = 'de' } = {}) => {
    const existing = await CaseDocument.countDocuments({ case: caseId });
    if (existing > 0) return { created: 0 };

    const caseDoc = await Case.findById(caseId).populate(
        'customer',
        'vorname nachname email'
    );
    if (!caseDoc) return { created: 0 };
    if (!caseDoc.unterschrift?.zeitstempel && !caseDoc.unterschrift_anamnese?.zeitstempel) {
        return { created: 0 };
    }

    const docs = await recordSignedDocuments(caseDoc, { locale });
    return { created: docs.length };
};

const listDocumentsForCase = async (caseId, { locale = 'de' } = {}) => {
    await ensureCaseDocuments(caseId, { locale });
    const docs = await CaseDocument.find({ case: caseId })
        .sort({ type: 1, version: -1 })
        .lean();
    return docs.map(formatDocument);
};

const listDocumentsForCustomer = async (customerId, { locale = 'de' } = {}) => {
    // Backfill signed cases that still only have JPEG signatures
    const CaseModel = Case;
    const signedCases = await CaseModel.find({
        customer: customerId,
        $or: [
            { 'unterschrift.zeitstempel': { $ne: null } },
            { 'unterschrift_anamnese.zeitstempel': { $ne: null } },
        ],
    })
        .select('_id')
        .lean();

    await Promise.all(
        signedCases.map((c) => ensureCaseDocuments(c._id, { locale }).catch(() => null))
    );

    const docs = await CaseDocument.find({ customer: customerId })
        .sort({ signed_at: -1, version: -1 })
        .lean();

    const groupedMap = new Map();
    for (const doc of docs) {
        const formatted = formatDocument(doc);
        const caseKey = formatted.case.id;
        if (!groupedMap.has(caseKey)) {
            groupedMap.set(caseKey, {
                case: formatted.case,
                studio: formatted.studio,
                documents: [],
            });
        }
        groupedMap.get(caseKey).documents.push(formatted);
    }

    return {
        groups: Array.from(groupedMap.values()),
        documents: docs.map(formatDocument),
    };
};

const getDocumentFile = async (docId) => {
    const doc = await CaseDocument.findById(docId);
    if (!doc) return null;
    const absolute = path.join(UPLOAD_ROOT, doc.storage_path);
    const buffer = await fs.readFile(absolute);
    return { doc, buffer };
};

module.exports = {
    CASE_DOCUMENT_TYPES,
    createDocumentVersion,
    recordSignedDocuments,
    ensureCaseDocuments,
    listDocumentsForCase,
    listDocumentsForCustomer,
    getDocumentFile,
    formatDocument,
};

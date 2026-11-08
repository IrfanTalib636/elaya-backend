require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const { UPLOAD_ROOT } = require('../config/storageConfig');
const Case = require('../models/caseModel');
const Anamnesis = require('../models/anamnesisModel');
const Studio = require('../models/studioModel');
const Customer = require('../models/customerModel');
const CaseDocument = require('../models/caseDocumentModel');
const { CASE_DOCUMENT_TYPES } = require('../models/caseDocumentModel');
const {
    buildCaseDocumentPdf,
    documentTitle,
} = require('../utils/caseDocumentPdf');
const {
    createDocumentVersion,
    recordSignedDocuments,
    ensureCaseDocuments,
    listDocumentsForCase,
    listDocumentsForCustomer,
    getDocumentFile,
    formatDocument,
} = require('../services/caseDocumentService');
const { emptyAnamnesisAnswers } = require('../utils/anamnesisEngine');
const { saveSignatureImage } = require('../utils/signatureStorage');

let passed = 0;
let failed = 0;

const check = (ok, label, detail = '') => {
    if (ok) {
        passed += 1;
        console.log(`PASS  ${label}`);
    } else {
        failed += 1;
        console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
    }
};

const oid = () => new mongoose.Types.ObjectId();

/** Minimal valid 1x1 JPEG */
const TINY_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z',
    'base64'
);

const runUnit = async () => {
    console.log('\n=== Unit: PDF generator ===');

    const { buffer, contentHash, title } = await buildCaseDocumentPdf({
        type: CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS,
        version: 1,
        locale: 'en',
        customerName: 'Ada Lovelace',
        caseCode: '#ARM-001',
        caseTitle: 'Left arm',
        studioName: 'Elaya Test Studio',
        signedAt: new Date('2026-11-07T20:45:00Z'),
        confirmationText: 'I confirm the answers are truthful.',
        answerRows: [
            { nr: 1, key: 'hauterkrankungen', label: 'Known skin diseases?', value: 'No' },
            { nr: 19, key: 'mindestalter_18', label: 'At least 18?', value: 'Yes' },
        ],
        signatureBuffer: TINY_JPEG,
    });

    check(Buffer.isBuffer(buffer) && buffer.length > 500, 'PDF buffer is non-trivial');
    check(buffer.slice(0, 4).toString() === '%PDF', 'PDF starts with %PDF magic');
    check(typeof contentHash === 'string' && contentHash.length === 64, 'content hash is sha256 hex');
    check(title === 'Medical anamnesis', `EN title is localized (got ${title})`);

    const deTitle = documentTitle(CASE_DOCUMENT_TYPES.CONSENT_MERKBLATT, 'de');
    check(
        deTitle === 'Einwilligung & Merkblatt',
        `DE consent title (got ${deTitle})`
    );

    const again = await buildCaseDocumentPdf({
        type: CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS,
        version: 1,
        locale: 'en',
        customerName: 'Ada Lovelace',
        caseCode: '#ARM-001',
        caseTitle: 'Left arm',
        studioName: 'Elaya Test Studio',
        signedAt: new Date('2026-11-07T20:45:00Z'),
        confirmationText: 'I confirm the answers are truthful.',
        answerRows: [
            { nr: 1, key: 'hauterkrankungen', label: 'Known skin diseases?', value: 'No' },
            { nr: 19, key: 'mindestalter_18', label: 'At least 18?', value: 'Yes' },
        ],
        signatureBuffer: TINY_JPEG,
    });
    check(
        again.contentHash === contentHash,
        'identical inputs produce identical content hash'
    );

    const merkblatt = await buildCaseDocumentPdf({
        type: CASE_DOCUMENT_TYPES.CONSENT_MERKBLATT,
        version: 2,
        locale: 'de',
        customerName: 'Max Muster',
        caseCode: '#ARM-002',
        studioName: 'Studio X',
        signedAt: new Date(),
        confirmationText: 'Bestätigt.',
        merkblattSections: [
            { title: 'ERSTE 7 TAGE', paragraphs: ['Kühlen Sie die Stelle.'] },
        ],
        signatureBuffer: TINY_JPEG,
    });
    check(
        merkblatt.buffer.slice(0, 4).toString() === '%PDF',
        'consent merkblatt PDF is valid'
    );
    check(merkblatt.title === 'Einwilligung & Merkblatt', 'DE merkblatt title');

    const formatted = formatDocument({
        _id: oid(),
        case: oid(),
        customer: oid(),
        studio: oid(),
        type: CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS,
        version: 3,
        locale: 'en',
        title: 'Medical anamnesis — Version 3',
        status: 'signed',
        signed_at: new Date(),
        size_bytes: 1000,
        meta: {
            case_code: '#ARM-003',
            case_title: 'Arm',
            studio_name: 'Studio Y',
            customer_name: 'Test',
        },
    });
    check(formatted.version === 3, 'formatDocument keeps version');
    check(formatted.case.caseId === '#ARM-003', 'formatDocument exposes case code');
    check(
        formatted.view_url.includes('/documents/') && formatted.download_url.includes('download=1'),
        'formatDocument builds view/download urls'
    );
};

const cleanup = async (ids) => {
    const { caseId, customerId, studioId, userId } = ids;
    await CaseDocument.deleteMany({ case: caseId });
    await Anamnesis.deleteMany({ case: caseId });
    await Case.deleteMany({ _id: caseId });
    await Customer.deleteMany({ _id: customerId });
    await Studio.deleteMany({ _id: studioId });
    if (userId) {
        const User = require('../models/userModel');
        await User.deleteMany({ _id: userId });
    }
    try {
        await fs.rm(path.join(UPLOAD_ROOT, studioId.toString()), { recursive: true, force: true });
    } catch {
        /* ignore */
    }
};

const runIntegration = async () => {
    console.log('\n=== Integration: versioning + backfill + list ===');
    await connectDB();

    const User = require('../models/userModel');
    const studioId = oid();
    const userId = oid();
    const customerId = oid();
    const caseId = oid();
    const ids = { caseId, customerId, studioId, userId };

    try {
        await User.collection.insertOne({
            _id: userId,
            email: `doc-test-${userId}@elaya.test`,
            password: 'x',
            role: 'studio_admin',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await Studio.collection.insertOne({
            _id: studioId,
            firma: 'Document Test Studio',
            studio_code: `DOC${String(studioId).slice(-4).toUpperCase()}`,
            email: `studio-${studioId}@elaya.test`,
            owner: userId,
            status: 'aktiv',
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await Customer.collection.insertOne({
            _id: customerId,
            vorname: 'Ada',
            nachname: 'Lovelace',
            email: `ada-${customerId}@elaya.test`,
            aktuelle_firma_id: studioId,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const merkblattPath = await saveSignatureImage(studioId, caseId, TINY_JPEG);
        const anamnesePath = await saveSignatureImage(
            studioId,
            caseId,
            TINY_JPEG,
            'signature-anamnese.jpg'
        );

        const signedAt = new Date('2026-11-07T20:45:00Z');
        await Case.collection.insertOne({
            _id: caseId,
            customer: customerId,
            studio: studioId,
            caseId: '#ARM-DOC-001',
            type: 'tattoo',
            status: 'pending',
            tc_title: 'Left arm script',
            bodyLabel: 'Arm · Links',
            anamnesis_complete: true,
            akquise_quelle: 'studio_eigen',
            unterschrift: {
                zeitstempel: signedAt,
                merkblatt_gelesen: true,
                bestaetigung_text: 'I have read the information sheet.',
                unterschrift_data: merkblattPath,
            },
            unterschrift_anamnese: {
                zeitstempel: signedAt,
                anamnese_bestaetigt: true,
                bestaetigung_text: 'Medical answers are truthful.',
                unterschrift_data: anamnesePath,
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        await Anamnesis.collection.insertOne({
            case: caseId,
            antworten: {
                ...emptyAnamnesisAnswers(),
                hauterkrankungen: ['nein'],
                mindestalter_18: 'ja',
                urteilsfaehig: 'ja',
                zeitstempel: signedAt.toISOString(),
            },
            ampel_status: 'gruen',
            filled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // Backfill when no docs exist yet
        const before = await CaseDocument.countDocuments({ case: caseId });
        check(before === 0, 'starts with zero document records');

        const ensured = await ensureCaseDocuments(caseId, { locale: 'en' });
        check(ensured.created === 2, `lazy backfill creates 2 docs (got ${ensured.created})`);

        const ensuredAgain = await ensureCaseDocuments(caseId, { locale: 'en' });
        check(ensuredAgain.created === 0, 'second ensure is a no-op');

        const listed = await listDocumentsForCase(caseId, { locale: 'en' });
        check(listed.length === 2, `case list returns 2 docs (got ${listed.length})`);
        check(
            listed.every((d) => d.status === 'signed' && d.version === 1),
            'backfilled docs are signed v1'
        );
        check(
            listed.some((d) => d.type === CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS) &&
                listed.some((d) => d.type === CASE_DOCUMENT_TYPES.CONSENT_MERKBLATT),
            'both document types present'
        );

        const studioNameOk = listed.every(
            (d) => d.studio?.name === 'Document Test Studio' || d.case
        );
        check(
            listed.every((d) => (d.studio?.name || '').includes('Document Test Studio')),
            `studio name comes from firma (got ${listed.map((d) => d.studio?.name).join(',')})`
        );

        // PDF files readable
        for (const doc of listed) {
            const file = await getDocumentFile(doc.id);
            check(
                file && file.buffer.slice(0, 4).toString() === '%PDF',
                `stored PDF readable for ${doc.type} v${doc.version}`
            );
            check(file.doc.content_hash?.length === 64, `hash stored for ${doc.type}`);
        }

        // Resign → new versions (never overwrite)
        const resignAt = new Date('2027-01-15T10:00:00Z');
        await Case.collection.updateOne(
            { _id: caseId },
            {
                $set: {
                    'unterschrift.zeitstempel': resignAt,
                    'unterschrift_anamnese.zeitstempel': resignAt,
                },
            }
        );
        const caseDoc = await Case.findById(caseId).populate('customer', 'vorname nachname email');

        const created = await recordSignedDocuments(caseDoc, { locale: 'en' });
        check(created.length === 2, `resign records 2 new docs (got ${created.length})`);
        check(
            created.every((d) => d.version === 2),
            `resign creates version 2 (got ${created.map((d) => d.version).join(',')})`
        );

        const afterResign = await listDocumentsForCase(caseId, { locale: 'en' });
        check(afterResign.length === 4, `history keeps all versions (got ${afterResign.length})`);

        const anamnesisVersions = afterResign
            .filter((d) => d.type === CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS)
            .map((d) => d.version)
            .sort();
        check(
            JSON.stringify(anamnesisVersions) === '[1,2]',
            `anamnesis versions [1,2] (got ${JSON.stringify(anamnesisVersions)})`
        );

        // Customer grouping
        const customerList = await listDocumentsForCustomer(customerId, { locale: 'en' });
        check(
            customerList.groups.length === 1,
            `customer groups by case (got ${customerList.groups.length})`
        );
        check(
            customerList.groups[0].documents.length === 4,
            `group contains all 4 docs (got ${customerList.groups[0].documents.length})`
        );
        check(
            customerList.documents.length === 4,
            'flat documents array also returned'
        );

        // Explicit createDocumentVersion increments further
        const v3 = await createDocumentVersion({
            caseDoc,
            type: CASE_DOCUMENT_TYPES.MEDICAL_ANAMNESIS,
            locale: 'en',
            signedAt: new Date(),
        });
        check(v3.version === 3, `manual create bumps to v3 (got ${v3.version})`);
        check(
            (v3.title || '').includes('Version 3'),
            `title includes version (got ${v3.title})`
        );
    } finally {
        await cleanup(ids);
        await mongoose.connection.close().catch(() => null);
    }
};

const main = async () => {
    console.log('verifyCaseDocuments');
    await runUnit();
    await runIntegration();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
};

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

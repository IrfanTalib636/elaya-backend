const PDFDocument = require('pdfkit');
const crypto = require('crypto');

const TITLES = {
    medical_anamnesis: {
        de: 'Medizinische Anamnese',
        en: 'Medical anamnesis',
    },
    consent_merkblatt: {
        de: 'Einwilligung & Merkblatt',
        en: 'Consent & information sheet',
    },
};

const LABELS = {
    de: {
        platform: 'ELAYA — Tattoo Removal Platform',
        customer: 'Kunde',
        case: 'Tattoo Case',
        studio: 'Studio',
        type: 'Dokumenttyp',
        version: 'Version',
        signedAt: 'Unterzeichnet am',
        status: 'Status',
        signed: 'Unterschrieben',
        confirmation: 'Bestätigung',
        signature: 'Digitale Unterschrift',
        answers: 'Angaben',
        content: 'Inhalt',
        page: 'Seite',
    },
    en: {
        platform: 'ELAYA — Tattoo Removal Platform',
        customer: 'Customer',
        case: 'Tattoo Case',
        studio: 'Studio',
        type: 'Document type',
        version: 'Version',
        signedAt: 'Signed at',
        status: 'Status',
        signed: 'Signed',
        confirmation: 'Confirmation',
        signature: 'Digital signature',
        answers: 'Answers',
        content: 'Content',
        page: 'Page',
    },
};

const formatDateTime = (date, locale) => {
    try {
        return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-CH', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }).format(new Date(date));
    } catch {
        return new Date(date).toISOString();
    }
};

const documentTitle = (type, locale) =>
    TITLES[type]?.[locale] || TITLES[type]?.de || type;

/**
 * Build a signed case PDF buffer (self-contained; embeds signature image).
 */
const buildCaseDocumentPdf = async ({
    type,
    version,
    locale = 'de',
    customerName,
    caseCode,
    caseTitle,
    studioName,
    signedAt,
    confirmationText,
    answerRows = [],
    merkblattSections = [],
    signatureBuffer = null,
}) => {
    const loc = locale === 'en' ? 'en' : 'de';
    const L = LABELS[loc];
    const title = documentTitle(type, loc);

    const signedDate = signedAt ? new Date(signedAt) : new Date();
    const doc = new PDFDocument({
        size: 'A4',
        bufferPages: true,
        margins: { top: 48, bottom: 56, left: 48, right: 48 },
        info: {
            Title: `${title} — ${caseCode} — v${version}`,
            Author: 'ELAYA',
            Subject: `${type} signed document`,
            // Deterministic timestamps so identical inputs hash identically.
            CreationDate: signedDate,
            ModDate: signedDate,
        },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    const done = new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });

    // Header
    doc.fontSize(11).fillColor('#1e6fd9').text(L.platform, { align: 'left' });
    doc.moveDown(0.4);
    doc.fontSize(18).fillColor('#0a1628').text(title, { align: 'left' });
    doc.moveDown(0.6);
    doc
        .moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .strokeColor('#1e6fd9')
        .lineWidth(1)
        .stroke();
    doc.moveDown(0.8);

    const meta = [
        [L.customer, customerName || '—'],
        [L.case, `${caseCode || '—'}${caseTitle ? ` · ${caseTitle}` : ''}`],
        [L.studio, studioName || '—'],
        [L.type, title],
        [L.version, String(version)],
        [L.signedAt, formatDateTime(signedDate, loc)],
        [L.status, L.signed],
    ];

    doc.fontSize(10).fillColor('#0a1628');
    for (const [label, value] of meta) {
        doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
        doc.font('Helvetica').text(String(value));
    }

    doc.moveDown(0.8);

    if (type === 'medical_anamnesis' && answerRows.length) {
        doc.fontSize(12).font('Helvetica-Bold').text(L.answers);
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(9);
        for (const row of answerRows) {
            if (doc.y > doc.page.height - 120) doc.addPage();
            const label = `${row.nr}. ${row.label}`;
            const value = String(row.value || '—');
            doc.fillColor('#334155').text(`${label}:  `, { continued: true });
            doc.fillColor('#0a1628').text(value);
            doc.moveDown(0.12);
        }
    }

    if (type === 'consent_merkblatt' && merkblattSections.length) {
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#0a1628').text(L.content);
        doc.moveDown(0.4);
        for (const section of merkblattSections) {
            if (doc.y > doc.page.height - 140) doc.addPage();
            doc.fontSize(11).font('Helvetica-Bold').fillColor('#1e6fd9').text(section.title || '');
            doc.moveDown(0.25);
            doc.font('Helvetica').fontSize(9).fillColor('#334155');
            for (const p of section.paragraphs || []) {
                doc.text(p, { align: 'justify', lineGap: 2 });
                doc.moveDown(0.35);
            }
            doc.moveDown(0.3);
        }
    }

    if (confirmationText) {
        if (doc.y > doc.page.height - 160) doc.addPage();
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#0a1628').text(L.confirmation);
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(9).fillColor('#334155').text(String(confirmationText), {
            align: 'left',
            lineGap: 2,
        });
    }

    if (signatureBuffer && signatureBuffer.length) {
        if (doc.y > doc.page.height - 180) doc.addPage();
        doc.moveDown(0.8);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#0a1628').text(L.signature);
        doc.moveDown(0.4);
        try {
            doc.image(signatureBuffer, {
                fit: [240, 90],
                align: 'left',
            });
        } catch {
            doc.font('Helvetica').fontSize(9).fillColor('#64748b').text('(signature image unavailable)');
        }
    }

    // Footer page numbers
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);
        doc
            .fontSize(8)
            .fillColor('#94a3b8')
            .text(
                `${L.page} ${i + 1} / ${range.count} · ${caseCode || ''} · v${version}`,
                doc.page.margins.left,
                doc.page.height - 36,
                {
                    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
                    align: 'center',
                }
            );
    }

    doc.end();
    const buffer = await done;
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    return { buffer, contentHash, title };
};

module.exports = {
    buildCaseDocumentPdf,
    documentTitle,
    CASE_DOCUMENT_TITLES: TITLES,
};

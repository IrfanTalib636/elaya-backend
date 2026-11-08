const Case = require('../models/caseModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertCaseAccess, isCustomer } = require('../utils/accessHelpers');
const {
    listDocumentsForCase,
    listDocumentsForCustomer,
    getDocumentFile,
} = require('../services/caseDocumentService');

const resolveLocale = (req) => (req.query.locale === 'en' ? 'en' : 'de');

const listCaseDocuments = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id).select('_id customer studio');
    if (!caseDoc) throw new ApiError(404, 'Case not found');
    await assertCaseAccess(req.user, caseDoc);

    const documents = await listDocumentsForCase(caseDoc._id, {
        locale: resolveLocale(req),
    });

    res.status(200).json({
        success: true,
        data: { documents },
    });
});

const listMyDocuments = asyncHandler(async (req, res) => {
    if (!isCustomer(req.user.role) || !req.user.customer_id) {
        throw new ApiError(403, 'Customers only');
    }

    const data = await listDocumentsForCustomer(req.user.customer_id, {
        locale: resolveLocale(req),
    });

    res.status(200).json({
        success: true,
        data,
    });
});

const getDocumentContent = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id).select('_id customer studio');
    if (!caseDoc) throw new ApiError(404, 'Case not found');
    await assertCaseAccess(req.user, caseDoc);

    const file = await getDocumentFile(req.params.docId);
    if (!file || String(file.doc.case) !== String(caseDoc._id)) {
        throw new ApiError(404, 'Document not found');
    }

    const download = req.query.download === '1' || req.query.download === 'true';
    const filename = `${file.doc.meta?.case_code || 'case'}-${file.doc.type}-v${file.doc.version}.pdf`
        .replace(/[^\w.\-#]+/g, '_');

    res.set('Content-Type', 'application/pdf');
    res.set('Cache-Control', 'private, no-store');
    res.set(
        'Content-Disposition',
        `${download ? 'attachment' : 'inline'}; filename="${filename}"`
    );
    res.send(file.buffer);
});

module.exports = {
    listCaseDocuments,
    listMyDocuments,
    getDocumentContent,
};

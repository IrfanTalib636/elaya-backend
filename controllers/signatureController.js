const path = require('path');
const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { assertCaseAccess, isCustomer } = require('../utils/accessHelpers');
const { getMerkblattContent } = require('../content/merkblattContent');
const { CASE_STATUS } = require('../config/constants');
const { syncCustomerPipeline } = require('../utils/pipelineEngine');
const { formatCase } = require('./caseController');
const {
    isSignatureStoragePath,
    parseSignatureImage,
    saveSignatureImage,
    migrateSignatureToDisk,
    readSignatureImage,
    SIGNATURE_ANAMNESE_FILENAME,
} = require('../utils/signatureStorage');

const formatCustomerRef = (customer) => {
    if (!customer) return null;
    if (typeof customer === 'object' && customer.vorname !== undefined) {
        return {
            id: customer._id?.toString(),
            vorname: customer.vorname ?? '',
            nachname: customer.nachname ?? '',
            email: customer.email ?? '',
            geburtsdatum: customer.geburtsdatum ?? '',
            telefon: customer.telefon ?? '',
        };
    }
    return null;
};

const getCaseMerkblatt = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id).populate(
        'customer',
        'vorname nachname email geburtsdatum telefon'
    );

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseAccess(req.user, caseDoc);

    const locale = req.query.locale === 'en' ? 'en' : 'de';
    const content = getMerkblattContent(locale);
    const customer = formatCustomerRef(caseDoc.customer);
    const signed = !!caseDoc.unterschrift?.zeitstempel;
    const anamnesisSigned = !!caseDoc.unterschrift_anamnese?.zeitstempel;

    res.status(200).json({
        success: true,
        data: {
            ...content,
            case: {
                id: caseDoc._id,
                caseId: caseDoc.caseId,
                type: caseDoc.type,
                bodyLabel: caseDoc.bodyLabel,
                tc_title: caseDoc.tc_title,
            },
            customer,
            requirements: {
                anamnesis_complete: caseDoc.anamnesis_complete === true,
                signature_complete: signed,
                anamnesis_signature_complete: anamnesisSigned,
            },
            signature_complete: signed,
            anamnesis_signature_complete: anamnesisSigned,
        },
    });
});

const getCaseSignatureImage = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id);

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseAccess(req.user, caseDoc);

    const variant = req.query.variant === 'anamnese' ? 'anamnese' : 'merkblatt';
    const stored =
        variant === 'anamnese'
            ? caseDoc.unterschrift_anamnese?.unterschrift_data
            : caseDoc.unterschrift?.unterschrift_data;
    if (!stored) {
        throw new ApiError(404, 'Signature image not found');
    }

    if (stored.startsWith('data:image/')) {
        const { buffer, mime } = parseSignatureImage(stored);
        if (variant === 'merkblatt') {
            await migrateSignatureToDisk(caseDoc);
        }
        res.set('Content-Type', mime === 'image/jpg' ? 'image/jpeg' : mime);
        res.set('Cache-Control', 'private, no-store');
        return res.send(buffer);
    }

    if (!isSignatureStoragePath(stored)) {
        throw new ApiError(404, 'Signature image not found');
    }

    try {
        const buffer = await readSignatureImage(stored);
        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'private, no-store');
        res.send(buffer);
    } catch {
        throw new ApiError(404, 'Signature image file missing');
    }
});

const submitCaseSignature = asyncHandler(async (req, res) => {
    const caseDoc = await Case.findById(req.params.id).populate(
        'customer',
        'vorname nachname email'
    );

    if (!caseDoc) {
        throw new ApiError(404, 'Case not found');
    }

    await assertCaseAccess(req.user, caseDoc);

    if (!caseDoc.anamnesis_complete) {
        throw new ApiError(400, 'Medical anamnesis must be completed before signature');
    }

    if (caseDoc.unterschrift?.zeitstempel && isCustomer(req.user.role)) {
        throw new ApiError(409, 'Case already signed. Contact your studio to make changes.');
    }

    const wasDraft = caseDoc.status === CASE_STATUS.DRAFT;
    const {
        merkblatt_gelesen,
        bestaetigung_text,
        unterschrift_data,
        merkblatt_pdf,
        anamnese_bestaetigt,
        anamnese_bestaetigung_text,
        anamnese_unterschrift_data,
    } = req.body;

    const { buffer } = parseSignatureImage(unterschrift_data);
    const storagePath = await saveSignatureImage(caseDoc.studio, caseDoc._id, buffer);

    const now = new Date();
    const bestaetigungStr =
        typeof bestaetigung_text === 'string'
            ? bestaetigung_text
            : getMerkblattContent('de').labels.confirmation_text;

    caseDoc.unterschrift = {
        zeitstempel: now,
        merkblatt_gelesen,
        bestaetigung_text: bestaetigungStr,
        unterschrift_data: storagePath,
    };

    if (anamnese_unterschrift_data) {
        const { buffer: anamneseBuffer } = parseSignatureImage(anamnese_unterschrift_data);
        const anamneseStoragePath = await saveSignatureImage(
            caseDoc.studio,
            caseDoc._id,
            anamneseBuffer,
            SIGNATURE_ANAMNESE_FILENAME
        );

        caseDoc.unterschrift_anamnese = {
            zeitstempel: now,
            anamnese_bestaetigt: anamnese_bestaetigt === true,
            bestaetigung_text:
                typeof anamnese_bestaetigung_text === 'string'
                    ? anamnese_bestaetigung_text
                    : getMerkblattContent('de').labels.confirmation_anamnesis_extra,
            unterschrift_data: anamneseStoragePath,
        };
        caseDoc.markModified('unterschrift_anamnese');
    }

    if (merkblatt_pdf) {
        caseDoc.merkblatt_pdf = merkblatt_pdf;
    }

    if (wasDraft) {
        caseDoc.status = CASE_STATUS.PENDING;
    }

    caseDoc.markModified('unterschrift');
    await caseDoc.save();

    const customerId = caseDoc.customer._id ?? caseDoc.customer;
    await syncCustomerPipeline(customerId);

    const zones = caseDoc.zonen_aktiv
        ? await CaseZone.find({ case: caseDoc._id }).sort({ zonen_id: 1 })
        : [];

    res.status(200).json({
        success: true,
        message: wasDraft ? 'Signature saved. Case finalized.' : 'Signature saved.',
        data: {
            case: formatCase(caseDoc, zones, req.user.role),
            signature_complete: true,
            anamnesis_signature_complete: !!caseDoc.unterschrift_anamnese?.zeitstempel,
            finalized: wasDraft,
            signature_bytes: buffer.length,
        },
    });
});

module.exports = {
    getCaseMerkblatt,
    getCaseSignatureImage,
    submitCaseSignature,
};

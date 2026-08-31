/**
 * Verifies permanent account deletion (DELETE /customers/me).
 *
 * Seeds a synthetic customer with a row in every collection the deletion
 * touches plus real files on disk, runs the service, then asserts that nothing
 * personal survived and that the retained accounting/consent records were
 * anonymized rather than dropped.
 *
 * Rows are inserted through `Model.collection.insertOne` on purpose: this
 * exercises the deletion queries, not the creation validators, so the fixtures
 * only need the linking fields the deletion actually matches on.
 *
 * Usage: node scripts/verifyAccountDeletion.js
 */
require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const connectDB = require('../config/db');
const { UPLOAD_ROOT } = require('../config/storageConfig');
const {
    deleteCustomerAccount,
    ANONYMIZED_NAME,
} = require('../services/accountDeletionService');

const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const Anamnesis = require('../models/anamnesisModel');
const NachsorgeCheck = require('../models/nachsorgeCheckModel');
const ChatConversation = require('../models/chatConversationModel');
const ChatMessage = require('../models/chatMessageModel');
const ActivityEvent = require('../models/activityEventModel');
const FileAsset = require('../models/fileAssetModel');
const FileAccessAudit = require('../models/fileAccessAuditModel');
const ShopOrder = require('../models/shopOrderModel');
const StudioTransferRequest = require('../models/studioTransferRequestModel');
const RefreshToken = require('../models/refreshTokenModel');
const PasswordResetToken = require('../models/passwordResetTokenModel');
const CrmNote = require('../models/crmNoteModel');
const CrmTask = require('../models/crmTaskModel');

let passed = 0;
let failed = 0;

const check = (label, ok, detail = '') => {
    if (ok) {
        passed += 1;
        console.log(`  PASS ${label}`);
    } else {
        failed += 1;
        console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    }
};

const oid = () => new mongoose.Types.ObjectId();

const writeFixtureFile = async (relative) => {
    const absolute = path.join(UPLOAD_ROOT, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, Buffer.from('fixture'));
    return relative;
};

const exists = async (relative) => {
    try {
        await fs.access(path.join(UPLOAD_ROOT, relative));
        return true;
    } catch {
        return false;
    }
};

const run = async () => {
    await connectDB();

    const studioId = oid();
    const userId = oid();
    const customerId = oid();
    const caseId = oid();
    const sessionId = oid();
    const otherCustomerId = oid();

    // --- files on disk -----------------------------------------------------
    const intakePhoto = await writeFixtureFile(`${studioId}/cases/${caseId}/main.jpg`);
    const signature = await writeFixtureFile(`${studioId}/cases/${caseId}/signature.jpg`);
    const anamneseSignature = await writeFixtureFile(
        `${studioId}/cases/${caseId}/signature-anamnese.jpg`
    );
    const stagingFileId = oid();
    const stagingPhoto = await writeFixtureFile(`${studioId}/staging/${stagingFileId}.png`);
    const progressPhoto = await writeFixtureFile(
        `${studioId}/sessions/${sessionId}/progress.jpg`
    );
    const transferSignature = await writeFixtureFile(
        `${studioId}/cases/${caseId}/transfer-signature.jpg`
    );

    // A file belonging to a different customer, in the same studio — must survive.
    const otherCaseId = oid();
    const bystanderPhoto = await writeFixtureFile(
        `${studioId}/cases/${otherCaseId}/main.jpg`
    );

    // --- database fixtures -------------------------------------------------
    await User.collection.insertOne({
        _id: userId,
        email: `deletion-test-${userId}@example.com`,
        role: 'customer',
        customer_id: customerId,
        status: 'aktiv',
    });
    await Customer.collection.insertOne({
        _id: customerId,
        vorname: 'Deletion',
        nachname: 'Fixture',
        user: userId,
        firma_id: studioId,
        aktuelle_firma_id: studioId,
        elaycoins: { balance: 250, transactions: [{ label: 'test', coins: 250 }] },
    });
    await Case.collection.insertOne({ _id: caseId, customer: customerId, studio: studioId });
    await CaseZone.collection.insertOne({ case: caseId, zonen_id: 'Z001' });
    await Anamnesis.collection.insertOne({ case: caseId });
    await Session.collection.insertOne({
        _id: sessionId,
        case: caseId,
        customer: customerId,
        studio: studioId,
    });
    await Appointment.collection.insertOne({
        case: caseId,
        customer: customerId,
        studio: studioId,
    });
    await NachsorgeCheck.collection.insertOne({
        customer: customerId,
        case: caseId,
        studio: studioId,
    });
    await ChatConversation.collection.insertOne({ customer: customerId, studio: studioId });
    await ChatMessage.collection.insertOne({
        customer: customerId,
        studio: studioId,
        text: 'private message',
    });
    await ActivityEvent.collection.insertOne({
        customer: customerId,
        studio: studioId,
        title: 'test event',
    });
    await RefreshToken.collection.insertOne({ user: userId, token_hash: `h-${userId}` });
    await PasswordResetToken.collection.insertOne({ user: userId, token_hash: `p-${userId}` });

    const intakeAssetId = oid();
    await FileAsset.collection.insertOne({
        _id: intakeAssetId,
        studio: studioId,
        customer: customerId,
        case: caseId,
        storage_path: intakePhoto,
        status: 'active',
    });
    // No customer field — reachable only through the case. Catches the mistake
    // of querying FileAsset by customer id alone.
    await FileAsset.collection.insertOne({
        studio: studioId,
        case: caseId,
        storage_path: stagingPhoto,
        status: 'staging',
    });
    await FileAsset.collection.insertOne({
        studio: studioId,
        session: sessionId,
        storage_path: progressPhoto,
        status: 'active',
    });
    await FileAccessAudit.collection.insertOne({ file: intakeAssetId, user: userId });

    const bystanderAssetId = oid();
    await FileAsset.collection.insertOne({
        _id: bystanderAssetId,
        studio: studioId,
        customer: otherCustomerId,
        case: otherCaseId,
        storage_path: bystanderPhoto,
        status: 'active',
    });

    await ShopOrder.collection.insertOne({
        studio: studioId,
        customer: customerId,
        total_chf: 120,
        stripe_payment_intent_id: 'pi_fixture',
        provision_betrag: 24,
        lieferadresse: {
            vorname: 'Deletion',
            nachname: 'Fixture',
            strasse: 'Teststrasse 1',
            plz: '8001',
            ort: 'Zürich',
            land: 'Schweiz',
        },
    });
    await StudioTransferRequest.collection.insertOne({
        customer: customerId,
        kunde_name: 'Deletion Fixture',
        von_firma_id: studioId,
        zu_firma_id: oid(),
        einwilligung_unterschrift: transferSignature,
    });
    await CrmNote.collection.insertOne({
        studio: studioId,
        customer: customerId,
        inhalt: 'studio internal note',
    });
    await CrmTask.collection.insertOne({
        studio: studioId,
        customer: customerId,
        titel: 'studio internal task',
    });

    // --- act ---------------------------------------------------------------
    console.log('\nDeleting account…');
    const report = await deleteCustomerAccount({ customerId, userId });
    console.log(`  report: ${JSON.stringify(report.deleted)}`);

    // --- assert: nothing personal survives ---------------------------------
    console.log('\nPersonal data is gone');
    const emptyChecks = [
        ['customer profile', Customer, { _id: customerId }],
        ['login', User, { _id: userId }],
        ['cases', Case, { customer: customerId }],
        ['case zones', CaseZone, { case: caseId }],
        ['anamnesis', Anamnesis, { case: caseId }],
        ['sessions', Session, { customer: customerId }],
        ['appointments', Appointment, { customer: customerId }],
        ['aftercare checks', NachsorgeCheck, { customer: customerId }],
        ['chat conversations', ChatConversation, { customer: customerId }],
        ['chat messages', ChatMessage, { customer: customerId }],
        ['activity events', ActivityEvent, { customer: customerId }],
        ['file assets', FileAsset, { case: caseId }],
        ['session file assets', FileAsset, { session: sessionId }],
        ['file access audits', FileAccessAudit, { user: userId }],
        ['refresh tokens', RefreshToken, { user: userId }],
        ['password reset tokens', PasswordResetToken, { user: userId }],
    ];
    for (const [label, Model, filter] of emptyChecks) {
        const count = await Model.countDocuments(filter);
        check(`${label} deleted`, count === 0, `${count} row(s) left`);
    }

    console.log('\nUploaded files are gone');
    for (const [label, relative] of [
        ['intake photo', intakePhoto],
        ['leaflet signature', signature],
        ['anamnesis signature', anamneseSignature],
        ['staging photo', stagingPhoto],
        ['session progress photo', progressPhoto],
        ['transfer consent signature', transferSignature],
    ]) {
        check(`${label} unlinked`, !(await exists(relative)));
    }
    check(
        'case directory removed',
        !(await exists(`${studioId}/cases/${caseId}`))
    );
    check(
        'session directory removed',
        !(await exists(`${studioId}/sessions/${sessionId}`))
    );

    console.log('\nOther customers are untouched');
    check(
        "another customer's file survives",
        await exists(bystanderPhoto),
        'deletion reached outside the account'
    );
    check(
        "another customer's file asset survives",
        (await FileAsset.countDocuments({ _id: bystanderAssetId })) === 1
    );

    console.log('\nRetained records are anonymized, not deleted');
    const order = await ShopOrder.findOne({ customer: customerId }).lean();
    check('paid order is retained', Boolean(order));
    check(
        'order keeps its accounting data',
        order?.stripe_payment_intent_id === 'pi_fixture' &&
            order?.total_chf === 120 &&
            order?.provision_betrag === 24
    );
    check(
        'order no longer holds name or address',
        order?.lieferadresse?.vorname === ANONYMIZED_NAME &&
            !order?.lieferadresse?.nachname &&
            !order?.lieferadresse?.strasse &&
            !order?.lieferadresse?.plz &&
            !order?.lieferadresse?.ort,
        JSON.stringify(order?.lieferadresse)
    );

    const transfer = await StudioTransferRequest.findOne({ customer: customerId }).lean();
    check('transfer consent record is retained', Boolean(transfer));
    check(
        'transfer record no longer holds name or signature',
        transfer?.kunde_name === ANONYMIZED_NAME && !transfer?.einwilligung_unterschrift
    );

    console.log('\nStudio-owned records are kept (per configuration)');
    check(
        'CRM note kept',
        (await CrmNote.countDocuments({ customer: customerId })) === 1
    );
    check(
        'CRM task kept',
        (await CrmTask.countDocuments({ customer: customerId })) === 1
    );

    console.log('\nRe-running the deletion is safe');
    const second = await deleteCustomerAccount({ customerId, userId });
    check(
        'second run deletes nothing and does not throw',
        Object.values(second.deleted).every((n) => n === 0),
        JSON.stringify(second.deleted)
    );

    // --- cleanup -----------------------------------------------------------
    await ShopOrder.deleteMany({ customer: customerId });
    await StudioTransferRequest.deleteMany({ customer: customerId });
    await CrmNote.deleteMany({ customer: customerId });
    await CrmTask.deleteMany({ customer: customerId });
    await FileAsset.deleteMany({ _id: bystanderAssetId });
    await fs.rm(path.join(UPLOAD_ROOT, studioId.toString()), {
        recursive: true,
        force: true,
    });

    console.log(`\n=== SUMMARY ===\n  passed: ${passed}\n  failed: ${failed}`);
    await mongoose.disconnect();
    process.exit(failed ? 1 : 0);
};

run().catch(async (err) => {
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});

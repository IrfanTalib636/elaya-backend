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
const { removeFile, removeDirectory } = require('./fileStorageService');
const {
    signatureRelativePath,
    SIGNATURE_FILENAME,
    SIGNATURE_ANAMNESE_FILENAME,
    isSignatureStoragePath,
} = require('../utils/signatureStorage');
const { getIO } = require('../sockets/io');

/**
 * Placeholder written over the customer name on records that survive deletion
 * for accounting or consent-audit reasons. Stored strings cannot be translated
 * at render time, and the studio dashboard is German-first.
 */
const ANONYMIZED_NAME = 'Gelöschtes Konto';

const idString = (value) => (value ? value.toString() : null);

/**
 * Deletes every file this customer's records point at, then the rows that
 * describe them. Files are keyed by studio + case on disk, never by customer,
 * so the paths have to be collected from the records before those are dropped.
 */
const purgeFiles = async ({ customerId, caseDocs, sessionIds }) => {
    const caseIds = caseDocs.map((c) => c._id);
    const removed = { files: 0, directories: 0 };

    // FileAsset.customer is optional, so an id-only query would miss assets
    // that were linked to a case or session without carrying the customer.
    const assetFilter = {
        $or: [
            { customer: customerId },
            ...(caseIds.length ? [{ case: { $in: caseIds } }] : []),
            ...(sessionIds.length ? [{ session: { $in: sessionIds } }] : []),
        ],
    };
    const assets = await FileAsset.find(assetFilter).select('_id storage_path').lean();

    for (const asset of assets) {
        await removeFile(asset.storage_path);
        removed.files += 1;
    }

    if (assets.length) {
        await FileAccessAudit.deleteMany({ file: { $in: assets.map((a) => a._id) } });
        await FileAsset.deleteMany({ _id: { $in: assets.map((a) => a._id) } });
    }

    // Signatures live in the case directory but are not tracked as FileAssets,
    // so they have to be unlinked by their two well-known filenames. Older
    // cases stored the image inline as base64 instead; those die with the Case.
    for (const caseDoc of caseDocs) {
        const studioId = idString(caseDoc.studio);
        if (!studioId) continue;
        for (const filename of [SIGNATURE_FILENAME, SIGNATURE_ANAMNESE_FILENAME]) {
            await removeFile(signatureRelativePath(studioId, caseDoc._id, filename));
            removed.files += 1;
        }
        await removeDirectory(`${studioId}/cases/${idString(caseDoc._id)}`);
        removed.directories += 1;
    }

    // Session progress photos live under the studio, not the case.
    const studioIds = [...new Set(caseDocs.map((c) => idString(c.studio)).filter(Boolean))];
    for (const sessionId of sessionIds) {
        for (const studioId of studioIds) {
            await removeDirectory(`${studioId}/sessions/${idString(sessionId)}`);
        }
        removed.directories += 1;
    }

    return removed;
};

/**
 * Overwrites personal data on records the studio keeps: paid shop orders are
 * accounting documents (Stripe intent, commission, Elaya revenue share) and
 * transfer requests are consent audit trails. The rows stay, the person does
 * not. `customer` is `required` on both schemas, so the now-dangling id is left
 * in place rather than unset — it resolves to nothing once the Customer is gone.
 */
const anonymizeRetainedRecords = async (customerId) => {
    const orders = await ShopOrder.updateMany(
        { customer: customerId },
        {
            $set: {
                'lieferadresse.vorname': ANONYMIZED_NAME,
                'lieferadresse.nachname': '',
                'lieferadresse.strasse': '',
                'lieferadresse.plz': '',
                'lieferadresse.ort': '',
            },
        }
    );

    const transferRequests = await StudioTransferRequest.find({ customer: customerId })
        .select('einwilligung_unterschrift')
        .lean();
    for (const request of transferRequests) {
        if (isSignatureStoragePath(request.einwilligung_unterschrift)) {
            await removeFile(request.einwilligung_unterschrift);
        }
    }
    const transfers = await StudioTransferRequest.updateMany(
        { customer: customerId },
        { $set: { kunde_name: ANONYMIZED_NAME, einwilligung_unterschrift: '' } }
    );

    return {
        shop_orders: orders.modifiedCount ?? 0,
        studio_transfer_requests: transfers.modifiedCount ?? 0,
    };
};

/**
 * Drops any live socket for the deleted user. Socket auth only runs at
 * connection time, so an already-open connection would otherwise keep its
 * rooms; reconnecting is refused automatically once the User row is gone.
 */
const disconnectUserSockets = (userId) => {
    const io = getIO();
    if (!io) return 0;
    const target = idString(userId);
    let dropped = 0;
    for (const socket of io.sockets.sockets.values()) {
        if (idString(socket.user?._id) === target) {
            socket.disconnect(true);
            dropped += 1;
        }
    }
    return dropped;
};

/**
 * Permanently erases a customer account: every record, every uploaded file, and
 * every credential. Irreversible, and required by the App Store privacy policy.
 *
 * Runs sequentially without a transaction — the deployment targets a standalone
 * mongod, where multi-document transactions are unavailable. The order is
 * therefore chosen so an interrupted run is safely resumable: leaf data first,
 * and the Customer plus User rows last, so the caller can always authenticate
 * and retry until the account is fully gone.
 *
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId} params.customerId
 * @param {import('mongoose').Types.ObjectId} params.userId
 * @returns {Promise<object>} counts per collection, for the audit log
 */
const deleteCustomerAccount = async ({ customerId, userId }) => {
    const caseDocs = await Case.find({ customer: customerId }).select('_id studio').lean();
    const caseIds = caseDocs.map((c) => c._id);

    const sessionDocs = await Session.find({
        $or: [{ customer: customerId }, ...(caseIds.length ? [{ case: { $in: caseIds } }] : [])],
    })
        .select('_id')
        .lean();
    const sessionIds = sessionDocs.map((s) => s._id);

    const byCase = caseIds.length ? { case: { $in: caseIds } } : { _id: null };
    const ownedBy = (extra) => ({ $or: [{ customer: customerId }, extra] });

    const removedFiles = await purgeFiles({ customerId, caseDocs, sessionIds });

    const deleted = {};
    const run = async (key, promise) => {
        const result = await promise;
        deleted[key] = result.deletedCount ?? 0;
    };

    await run('nachsorge_checks', NachsorgeCheck.deleteMany(ownedBy(byCase)));
    await run('anamnesis', Anamnesis.deleteMany(byCase));
    await run('case_zones', CaseZone.deleteMany(byCase));
    await run('sessions', Session.deleteMany(ownedBy(byCase)));
    await run('appointments', Appointment.deleteMany(ownedBy(byCase)));
    await run('chat_messages', ChatMessage.deleteMany({ customer: customerId }));
    await run('chat_conversations', ChatConversation.deleteMany({ customer: customerId }));
    await run('activity_events', ActivityEvent.deleteMany({ customer: customerId }));
    await run('cases', Case.deleteMany({ customer: customerId }));

    const anonymized = await anonymizeRetainedRecords(customerId);

    await run('file_access_audits', FileAccessAudit.deleteMany({ user: userId }));
    await run('refresh_tokens', RefreshToken.deleteMany({ user: userId }));
    await run('password_reset_tokens', PasswordResetToken.deleteMany({ user: userId }));

    // Last: the identity itself. The embedded Elaycoin ledger and activity log
    // live on these documents and die with them.
    await run('customers', Customer.deleteOne({ _id: customerId }));
    await run('users', User.deleteOne({ _id: userId }));

    const socketsDropped = disconnectUserSockets(userId);

    return { deleted, anonymized, files: removedFiles, sockets_disconnected: socketsDropped };
};

module.exports = {
    deleteCustomerAccount,
    ANONYMIZED_NAME,
};

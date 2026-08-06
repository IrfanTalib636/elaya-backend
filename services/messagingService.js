const ApiError = require('../utils/ApiError');
const ChatConversation = require('../models/chatConversationModel');
const ChatMessage = require('../models/chatMessageModel');
const Customer = require('../models/customerModel');
const Studio = require('../models/studioModel');
const Case = require('../models/caseModel');
const {
    CHAT_CONVERSATION_STATUS,
    CHAT_MESSAGE_TYP,
    CHAT_SENDER_ROLE,
} = require('../config/constants');
const {
    refId,
    isCustomer,
    isStudio,
    isAdmin,
    assertCaseAccess,
} = require('../utils/accessHelpers');

const PREVIEW_MAX = 280;
const TEXT_MAX = 4000;

const conversationRoom = (conversationId) => `conversation:${conversationId}`;
const userRoom = (userId) => `user:${userId}`;
const studioRoom = (studioId) => `studio:${studioId}`;

const truncatePreview = (text) => {
    const cleaned = String(text || '').trim().replace(/\s+/g, ' ');
    if (cleaned.length <= PREVIEW_MAX) return cleaned;
    return `${cleaned.slice(0, PREVIEW_MAX - 1)}…`;
};

const formatMessage = (doc) => {
    const m = doc.toObject ? doc.toObject() : doc;
    return {
        id: String(m._id),
        conversation_id: refId(m.conversation),
        customer_id: refId(m.customer),
        studio_id: refId(m.studio),
        sender_user_id: refId(m.sender_user),
        sender_role: m.sender_role,
        typ: m.typ,
        text: m.text,
        case_id: refId(m.case_id),
        read_by_customer_at: m.read_by_customer_at || null,
        read_by_studio_at: m.read_by_studio_at || null,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
    };
};

const formatConversation = (doc, extras = {}) => {
    const c = doc.toObject ? doc.toObject() : doc;
    const customer = extras.customer || c.customer;
    const studio = extras.studio || c.studio;

    const customerSummary =
        customer && typeof customer === 'object' && customer._id
            ? {
                  id: String(customer._id),
                  vorname: customer.vorname || '',
                  nachname: customer.nachname || '',
                  email: customer.email || '',
              }
            : customer
              ? { id: refId(customer) }
              : null;

    const studioSummary =
        studio && typeof studio === 'object' && studio._id
            ? {
                  id: String(studio._id),
                  firma: studio.firma || '',
                  studio_code: studio.studio_code || '',
              }
            : studio
              ? { id: refId(studio) }
              : null;

    return {
        id: String(c._id),
        customer: customerSummary,
        studio: studioSummary,
        status: c.status,
        last_message_at: c.last_message_at || null,
        last_message_preview: c.last_message_preview || '',
        last_sender_role: c.last_sender_role || null,
        unread_customer: c.unread_customer || 0,
        unread_studio: c.unread_studio || 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
};

const loadCustomerOrThrow = async (customerId) => {
    const customer = await Customer.findById(customerId)
        .select('vorname nachname email aktuelle_firma_id')
        .lean();
    if (!customer) {
        throw new ApiError(404, 'Customer not found');
    }
    return customer;
};

/**
 * Who may participate in this conversation.
 * Write requires active studio assignment for customers; studios must own the thread.
 */
const assertConversationAccess = async (user, conversation, { write = false } = {}) => {
    if (isAdmin(user.role)) {
        return { read_only: false };
    }

    if (isCustomer(user.role)) {
        if (refId(conversation.customer) !== refId(user.customer_id)) {
            throw new ApiError(403, 'You do not have access to this conversation');
        }
        if (write) {
            const customer = await Customer.findById(user.customer_id)
                .select('aktuelle_firma_id')
                .lean();
            if (!customer || refId(customer.aktuelle_firma_id) !== refId(conversation.studio)) {
                throw new ApiError(
                    403,
                    'You can only message your current studio'
                );
            }
        }
        return { read_only: false };
    }

    if (isStudio(user.role)) {
        if (refId(conversation.studio) !== refId(user.studio_id)) {
            throw new ApiError(403, 'You do not have access to this conversation');
        }
        if (write) {
            const customer = await Customer.findById(conversation.customer)
                .select('aktuelle_firma_id')
                .lean();
            if (!customer || refId(customer.aktuelle_firma_id) !== refId(user.studio_id)) {
                throw new ApiError(
                    403,
                    'Customer is no longer assigned to this studio — conversation is read-only'
                );
            }
        }
        return { read_only: false };
    }

    throw new ApiError(403, 'You do not have permission for this action');
};

const getOrCreateConversation = async (user, { customer_id, studio_id } = {}) => {
    let customerId = customer_id ? String(customer_id) : null;
    let studioId = studio_id ? String(studio_id) : null;

    if (isCustomer(user.role)) {
        customerId = refId(user.customer_id);
        const customer = await loadCustomerOrThrow(customerId);
        studioId = refId(customer.aktuelle_firma_id);
        if (!studioId) {
            throw new ApiError(400, 'No studio assigned — cannot open live chat');
        }
    } else if (isStudio(user.role)) {
        studioId = refId(user.studio_id);
        if (!customerId) {
            throw new ApiError(400, 'customer_id is required');
        }
        const customer = await loadCustomerOrThrow(customerId);
        if (refId(customer.aktuelle_firma_id) !== studioId) {
            throw new ApiError(403, 'Customer is not assigned to your studio');
        }
    } else if (isAdmin(user.role)) {
        if (!customerId || !studioId) {
            throw new ApiError(400, 'customer_id and studio_id are required');
        }
        await loadCustomerOrThrow(customerId);
    } else {
        throw new ApiError(403, 'You do not have permission for this action');
    }

    const studio = await Studio.findById(studioId).select('firma studio_code').lean();
    if (!studio) {
        throw new ApiError(404, 'Studio not found');
    }

    let conversation = await ChatConversation.findOne({
        customer: customerId,
        studio: studioId,
    });

    if (!conversation) {
        conversation = await ChatConversation.create({
            customer: customerId,
            studio: studioId,
            status: CHAT_CONVERSATION_STATUS.OPEN,
        });
    }

    const customer = await loadCustomerOrThrow(customerId);
    return formatConversation(conversation, { customer, studio });
};

const listConversations = async (user, { skip = 0, limit = 20 } = {}) => {
    const filter = { status: CHAT_CONVERSATION_STATUS.OPEN };

    if (isCustomer(user.role)) {
        filter.customer = user.customer_id;
    } else if (isStudio(user.role)) {
        filter.studio = user.studio_id;
    } else if (!isAdmin(user.role)) {
        throw new ApiError(403, 'You do not have permission for this action');
    }

    const [rows, total] = await Promise.all([
        ChatConversation.find(filter)
            .sort({ last_message_at: -1, updatedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('customer', 'vorname nachname email')
            .populate('studio', 'firma studio_code')
            .lean(),
        ChatConversation.countDocuments(filter),
    ]);

    return {
        conversations: rows.map((row) => formatConversation(row)),
        total,
    };
};

const getConversationById = async (user, conversationId) => {
    const conversation = await ChatConversation.findById(conversationId)
        .populate('customer', 'vorname nachname email')
        .populate('studio', 'firma studio_code');

    if (!conversation) {
        throw new ApiError(404, 'Conversation not found');
    }

    await assertConversationAccess(user, conversation, { write: false });
    return formatConversation(conversation);
};

const listMessages = async (user, conversationId, { skip = 0, limit = 50, before_id } = {}) => {
    const conversation = await ChatConversation.findById(conversationId);
    if (!conversation) {
        throw new ApiError(404, 'Conversation not found');
    }
    await assertConversationAccess(user, conversation, { write: false });

    const filter = { conversation: conversationId };
    if (before_id) {
        filter._id = { $lt: before_id };
    }

    const [rows, total] = await Promise.all([
        ChatMessage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        ChatMessage.countDocuments({ conversation: conversationId }),
    ]);

    return {
        messages: rows.map(formatMessage).reverse(),
        total,
        conversation: formatConversation(conversation),
    };
};

const sendMessage = async (user, conversationId, { text, case_id } = {}) => {
    const cleaned = String(text || '').trim();
    if (!cleaned) {
        throw new ApiError(400, 'text is required');
    }
    if (cleaned.length > TEXT_MAX) {
        throw new ApiError(400, `text must be at most ${TEXT_MAX} characters`);
    }

    const conversation = await ChatConversation.findById(conversationId);
    if (!conversation) {
        throw new ApiError(404, 'Conversation not found');
    }
    if (conversation.status === CHAT_CONVERSATION_STATUS.ARCHIVED) {
        throw new ApiError(400, 'Conversation is archived');
    }

    await assertConversationAccess(user, conversation, { write: true });

    let senderRole = CHAT_SENDER_ROLE.SYSTEM;
    if (isCustomer(user.role)) {
        senderRole = CHAT_SENDER_ROLE.CUSTOMER;
    } else if (isStudio(user.role) || isAdmin(user.role)) {
        senderRole = CHAT_SENDER_ROLE.STUDIO;
    }

    let caseObjectId = null;
    if (case_id) {
        const caseDoc = await Case.findById(case_id).select('customer studio');
        if (!caseDoc) {
            throw new ApiError(404, 'Case not found');
        }
        await assertCaseAccess(user, caseDoc);
        if (refId(caseDoc.customer) !== refId(conversation.customer)) {
            throw new ApiError(400, 'case_id does not belong to this conversation customer');
        }
        caseObjectId = caseDoc._id;
    }

    const message = await ChatMessage.create({
        conversation: conversation._id,
        customer: conversation.customer,
        studio: conversation.studio,
        sender_user: user._id,
        sender_role: senderRole,
        typ: CHAT_MESSAGE_TYP.TEXT,
        text: cleaned,
        case_id: caseObjectId,
        read_by_customer_at: senderRole === CHAT_SENDER_ROLE.CUSTOMER ? new Date() : null,
        read_by_studio_at: senderRole === CHAT_SENDER_ROLE.STUDIO ? new Date() : null,
    });

    conversation.last_message_at = message.createdAt;
    conversation.last_message_preview = truncatePreview(cleaned);
    conversation.last_sender_role = senderRole;
    if (senderRole === CHAT_SENDER_ROLE.CUSTOMER) {
        conversation.unread_studio = (conversation.unread_studio || 0) + 1;
    } else if (senderRole === CHAT_SENDER_ROLE.STUDIO) {
        conversation.unread_customer = (conversation.unread_customer || 0) + 1;
    }
    await conversation.save();

    const populated = await ChatConversation.findById(conversation._id)
        .populate('customer', 'vorname nachname email')
        .populate('studio', 'firma studio_code');

    return {
        message: formatMessage(message),
        conversation: formatConversation(populated),
    };
};

const markConversationRead = async (user, conversationId, { up_to_message_id } = {}) => {
    const conversation = await ChatConversation.findById(conversationId);
    if (!conversation) {
        throw new ApiError(404, 'Conversation not found');
    }
    await assertConversationAccess(user, conversation, { write: false });

    const now = new Date();
    const filter = { conversation: conversationId };

    if (up_to_message_id) {
        filter._id = { $lte: up_to_message_id };
    }

    if (isCustomer(user.role)) {
        filter.read_by_customer_at = null;
        await ChatMessage.updateMany(filter, { $set: { read_by_customer_at: now } });
        conversation.unread_customer = 0;
    } else if (isStudio(user.role) || isAdmin(user.role)) {
        filter.read_by_studio_at = null;
        await ChatMessage.updateMany(filter, { $set: { read_by_studio_at: now } });
        conversation.unread_studio = 0;
    }

    await conversation.save();

    return {
        conversation: formatConversation(conversation),
        read_at: now,
    };
};

module.exports = {
    conversationRoom,
    userRoom,
    studioRoom,
    formatMessage,
    formatConversation,
    assertConversationAccess,
    getOrCreateConversation,
    listConversations,
    getConversationById,
    listMessages,
    sendMessage,
    markConversationRead,
};

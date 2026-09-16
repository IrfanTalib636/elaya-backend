const ApiError = require('../utils/ApiError');
const PlatformStudioConversation = require('../models/platformStudioConversationModel');
const PlatformStudioMessage = require('../models/platformStudioMessageModel');
const Studio = require('../models/studioModel');
const {
    CHAT_CONVERSATION_STATUS,
    CHAT_MESSAGE_TYP,
    PLATFORM_CHAT_SENDER_ROLE,
} = require('../config/constants');
const { refId, isStudio, isAdmin } = require('../utils/accessHelpers');

const PREVIEW_MAX = 280;
const TEXT_MAX = 4000;

const conversationRoom = (conversationId) => `platform_conversation:${conversationId}`;
const studioRoom = (studioId) => `studio:${studioId}`;
const adminRoom = () => 'platform:admins';

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
        studio_id: refId(m.studio),
        sender_user_id: refId(m.sender_user),
        sender_role: m.sender_role,
        typ: m.typ,
        text: m.text,
        read_by_admin_at: m.read_by_admin_at || null,
        read_by_studio_at: m.read_by_studio_at || null,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
    };
};

const formatConversation = (doc, extras = {}) => {
    const c = doc.toObject ? doc.toObject() : doc;
    const studio = extras.studio || c.studio;
    const studioSummary =
        studio && typeof studio === 'object' && studio._id
            ? {
                  id: String(studio._id),
                  firma: studio.firma || '',
                  studio_code: studio.studio_code || '',
                  ort: studio.ort || studio.standort || '',
                  status: studio.status || '',
              }
            : studio
              ? { id: refId(studio) }
              : null;

    return {
        id: String(c._id),
        studio: studioSummary,
        status: c.status,
        last_message_at: c.last_message_at || null,
        last_message_preview: c.last_message_preview || '',
        last_sender_role: c.last_sender_role || null,
        unread_admin: c.unread_admin || 0,
        unread_studio: c.unread_studio || 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
    };
};

const assertAccess = async (user, conversation, { write = false } = {}) => {
    if (isAdmin(user.role)) return;
    if (isStudio(user.role)) {
        if (refId(conversation.studio) !== refId(user.studio_id)) {
            throw new ApiError(403, 'You do not have access to this conversation');
        }
        return;
    }
    throw new ApiError(403, write ? 'Cannot write to this conversation' : 'Forbidden');
};

const loadStudioOrThrow = async (studioId) => {
    const studio = await Studio.findById(studioId)
        .select('firma studio_code ort status standorte')
        .lean();
    if (!studio) throw new ApiError(404, 'Studio not found');
    return studio;
};

/**
 * Admin inbox: every registered studio, merged with conversation previews.
 * Studio inbox: only their own platform thread (created on first open).
 */
const listStudioInbox = async (user, { q = '', skip = 0, limit = 100 } = {}) => {
    if (isStudio(user.role)) {
        const studioId = refId(user.studio_id);
        if (!studioId) throw new ApiError(400, 'Studio assignment required');
        const conversation = await PlatformStudioConversation.findOne({ studio: studioId })
            .populate('studio', 'firma studio_code ort status')
            .lean();
        return {
            items: conversation
                ? [formatConversation(conversation)]
                : [
                      formatConversation(
                          {
                              _id: null,
                              studio: studioId,
                              status: CHAT_CONVERSATION_STATUS.OPEN,
                              last_message_at: null,
                              last_message_preview: '',
                              unread_admin: 0,
                              unread_studio: 0,
                          },
                          { studio: await loadStudioOrThrow(studioId) }
                      ),
                  ],
            total: 1,
        };
    }

    if (!isAdmin(user.role)) {
        throw new ApiError(403, 'Forbidden');
    }

    const filter = {};
    const query = String(q || '').trim();
    if (query) {
        filter.$or = [
            { firma: { $regex: query, $options: 'i' } },
            { studio_code: { $regex: query, $options: 'i' } },
            { email: { $regex: query, $options: 'i' } },
            { ort: { $regex: query, $options: 'i' } },
        ];
    }

    const [studios, total] = await Promise.all([
        Studio.find(filter)
            .select('firma studio_code ort status email updatedAt')
            .sort({ firma: 1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Studio.countDocuments(filter),
    ]);

    const studioIds = studios.map((s) => s._id);
    const conversations = await PlatformStudioConversation.find({
        studio: { $in: studioIds },
    }).lean();
    const byStudio = new Map(conversations.map((c) => [String(c.studio), c]));

    const items = studios.map((studio) => {
        const existing = byStudio.get(String(studio._id));
        if (existing) {
            return formatConversation(existing, { studio });
        }
        return formatConversation(
            {
                _id: `pending:${studio._id}`,
                studio: studio._id,
                status: CHAT_CONVERSATION_STATUS.OPEN,
                last_message_at: null,
                last_message_preview: '',
                unread_admin: 0,
                unread_studio: 0,
            },
            { studio }
        );
    });

    // Conversations with recent messages float to the top; then A–Z.
    items.sort((a, b) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        if (aTime !== bTime) return bTime - aTime;
        return String(a.studio?.firma || '').localeCompare(String(b.studio?.firma || ''));
    });

    return { items, total };
};

const getOrCreateByStudio = async (user, studioId) => {
    let targetStudioId = studioId;
    if (isStudio(user.role)) {
        targetStudioId = refId(user.studio_id);
    } else if (!isAdmin(user.role)) {
        throw new ApiError(403, 'Forbidden');
    }
    if (!targetStudioId) throw new ApiError(400, 'studio_id is required');

    const studio = await loadStudioOrThrow(targetStudioId);
    let conversation = await PlatformStudioConversation.findOne({ studio: targetStudioId });
    if (!conversation) {
        conversation = await PlatformStudioConversation.create({
            studio: targetStudioId,
            status: CHAT_CONVERSATION_STATUS.OPEN,
        });
    }
    return formatConversation(conversation.toObject(), { studio });
};

const getConversationById = async (user, conversationId) => {
    // Pending synthetic ids are not stored — open by studio instead.
    if (String(conversationId).startsWith('pending:')) {
        const studioId = String(conversationId).slice('pending:'.length);
        return getOrCreateByStudio(user, studioId);
    }
    const conversation = await PlatformStudioConversation.findById(conversationId).populate(
        'studio',
        'firma studio_code ort status'
    );
    if (!conversation) throw new ApiError(404, 'Conversation not found');
    await assertAccess(user, conversation);
    return formatConversation(conversation);
};

const listMessages = async (user, conversationId, { skip = 0, limit = 50, before_id } = {}) => {
    const conversationDoc = await PlatformStudioConversation.findById(conversationId);
    if (!conversationDoc) throw new ApiError(404, 'Conversation not found');
    await assertAccess(user, conversationDoc);

    const filter = { conversation: conversationDoc._id };
    if (before_id) {
        filter._id = { $lt: before_id };
    }

    const [docs, total] = await Promise.all([
        PlatformStudioMessage.find(filter)
            .sort({ createdAt: -1, _id: -1 })
            .skip(before_id ? 0 : skip)
            .limit(limit)
            .lean(),
        PlatformStudioMessage.countDocuments({ conversation: conversationDoc._id }),
    ]);

    const studio = await loadStudioOrThrow(conversationDoc.studio);
    return {
        conversation: formatConversation(conversationDoc, { studio }),
        messages: docs.reverse().map(formatMessage),
        total,
    };
};

const sendMessage = async (user, conversationId, { text }) => {
    const cleaned = String(text || '').trim();
    if (!cleaned) throw new ApiError(400, 'Message text is required');
    if (cleaned.length > TEXT_MAX) {
        throw new ApiError(400, `Message must be at most ${TEXT_MAX} characters`);
    }

    let conversation = await PlatformStudioConversation.findById(conversationId);
    if (!conversation) throw new ApiError(404, 'Conversation not found');
    await assertAccess(user, conversation, { write: true });

    const sender_role = isAdmin(user.role)
        ? PLATFORM_CHAT_SENDER_ROLE.ADMIN
        : PLATFORM_CHAT_SENDER_ROLE.STUDIO;

    const message = await PlatformStudioMessage.create({
        conversation: conversation._id,
        studio: conversation.studio,
        sender_user: user._id,
        sender_role,
        typ: CHAT_MESSAGE_TYP.TEXT,
        text: cleaned,
        read_by_admin_at: sender_role === PLATFORM_CHAT_SENDER_ROLE.ADMIN ? new Date() : null,
        read_by_studio_at: sender_role === PLATFORM_CHAT_SENDER_ROLE.STUDIO ? new Date() : null,
    });

    conversation.last_message_at = message.createdAt;
    conversation.last_message_preview = truncatePreview(cleaned);
    conversation.last_sender_role = sender_role;
    if (sender_role === PLATFORM_CHAT_SENDER_ROLE.ADMIN) {
        conversation.unread_studio = (conversation.unread_studio || 0) + 1;
    } else {
        conversation.unread_admin = (conversation.unread_admin || 0) + 1;
    }
    await conversation.save();

    const studio = await loadStudioOrThrow(conversation.studio);
    return {
        message: formatMessage(message),
        conversation: formatConversation(conversation, { studio }),
    };
};

const markRead = async (user, conversationId) => {
    const conversation = await PlatformStudioConversation.findById(conversationId);
    if (!conversation) throw new ApiError(404, 'Conversation not found');
    await assertAccess(user, conversation);

    const now = new Date();
    if (isAdmin(user.role)) {
        await PlatformStudioMessage.updateMany(
            { conversation: conversation._id, read_by_admin_at: null },
            { $set: { read_by_admin_at: now } }
        );
        conversation.unread_admin = 0;
    } else if (isStudio(user.role)) {
        await PlatformStudioMessage.updateMany(
            { conversation: conversation._id, read_by_studio_at: null },
            { $set: { read_by_studio_at: now } }
        );
        conversation.unread_studio = 0;
    }
    await conversation.save();

    const studio = await loadStudioOrThrow(conversation.studio);
    return formatConversation(conversation, { studio });
};

module.exports = {
    conversationRoom,
    studioRoom,
    adminRoom,
    assertAccess,
    listStudioInbox,
    getOrCreateByStudio,
    getConversationById,
    listMessages,
    sendMessage,
    markRead,
    formatMessage,
    formatConversation,
};

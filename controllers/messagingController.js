const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const messagingService = require('../services/messagingService');
const {
    emitMessageCreated,
    emitConversationRead,
} = require('../sockets/emitHelpers');

const listConversations = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { conversations, total } = await messagingService.listConversations(req.user, {
        skip,
        limit,
    });

    res.status(200).json({
        success: true,
        data: {
            conversations,
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const createOrGetConversation = asyncHandler(async (req, res) => {
    const conversation = await messagingService.getOrCreateConversation(req.user, req.body);
    res.status(200).json({
        success: true,
        data: { conversation },
    });
});

const getConversation = asyncHandler(async (req, res) => {
    const conversation = await messagingService.getConversationById(
        req.user,
        req.params.conversationId
    );
    res.status(200).json({
        success: true,
        data: { conversation },
    });
});

const listMessages = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination({
        page: req.query.page,
        limit: req.query.limit || 50,
    });
    const before_id =
        typeof req.query.before_id === 'string' && req.query.before_id.trim()
            ? req.query.before_id.trim()
            : undefined;

    const result = await messagingService.listMessages(req.user, req.params.conversationId, {
        skip: before_id ? 0 : skip,
        limit,
        before_id,
    });

    res.status(200).json({
        success: true,
        data: {
            conversation: result.conversation,
            messages: result.messages,
            pagination: buildPaginationMeta(page, limit, result.total),
        },
    });
});

const sendMessage = asyncHandler(async (req, res) => {
    const payload = await messagingService.sendMessage(
        req.user,
        req.params.conversationId,
        req.body
    );
    emitMessageCreated(payload);
    res.status(201).json({
        success: true,
        data: payload,
    });
});

const markRead = asyncHandler(async (req, res) => {
    const result = await messagingService.markConversationRead(
        req.user,
        req.params.conversationId,
        req.body
    );
    emitConversationRead(req.params.conversationId, {
        ...result,
        reader_role: req.user.role,
        reader_user_id: String(req.user._id),
    });
    res.status(200).json({
        success: true,
        data: result,
    });
});

module.exports = {
    listConversations,
    createOrGetConversation,
    getConversation,
    listMessages,
    sendMessage,
    markRead,
};

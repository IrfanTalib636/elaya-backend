const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const platformMessagingService = require('../services/platformMessagingService');
const { emitPlatformMessageCreated } = require('../sockets/emitHelpers');

const listInbox = asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination({
        page: req.query.page,
        limit: req.query.limit || 100,
    });
    const { items, total } = await platformMessagingService.listStudioInbox(req.user, {
        q: req.query.q,
        skip,
        limit,
    });

    res.status(200).json({
        success: true,
        data: {
            conversations: items,
            pagination: buildPaginationMeta(page, limit, total),
        },
    });
});

const openConversation = asyncHandler(async (req, res) => {
    const studioId = req.body.studio_id || req.body.studioId;
    const conversation = await platformMessagingService.getOrCreateByStudio(
        req.user,
        studioId
    );
    res.status(200).json({
        success: true,
        data: { conversation },
    });
});

const getConversation = asyncHandler(async (req, res) => {
    const conversation = await platformMessagingService.getConversationById(
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

    const result = await platformMessagingService.listMessages(
        req.user,
        req.params.conversationId,
        {
            skip: before_id ? 0 : skip,
            limit,
            before_id,
        }
    );

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
    const payload = await platformMessagingService.sendMessage(
        req.user,
        req.params.conversationId,
        req.body
    );
    emitPlatformMessageCreated(payload);
    res.status(201).json({
        success: true,
        data: payload,
    });
});

const markRead = asyncHandler(async (req, res) => {
    const conversation = await platformMessagingService.markRead(
        req.user,
        req.params.conversationId
    );
    res.status(200).json({
        success: true,
        data: { conversation },
    });
});

module.exports = {
    listInbox,
    openConversation,
    getConversation,
    listMessages,
    sendMessage,
    markRead,
};

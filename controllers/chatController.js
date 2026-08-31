const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
    isCustomer,
    isStudio,
    isAdmin,
    assertCaseAccess,
    resolveStudioCustomerRelation,
} = require('../utils/accessHelpers');
const Case = require('../models/caseModel');
const Customer = require('../models/customerModel');
const {
    ELAYA_ASSISTANT_SYSTEM,
    ELAYA_STUDIO_ASSISTANT_SYSTEM,
} = require('../content/aiPrompts');
const {
    callClaude,
    isAiEnabled,
} = require('../services/anthropicService');
const {
    buildCustomerChatContext,
    buildStudioChatContext,
} = require('../services/chatContextService');
const { vergebeElaycoins } = require('../utils/elaycoinEngine');

const ESKALATION_RE = /\[ESKALATION\|([A-ZÄÖÜ]+)\|([^\]]+)\]/;

const parseEskalation = (reply) => {
    const match = String(reply || '').match(ESKALATION_RE);
    if (!match) {
        return { reply: String(reply || '').trim(), eskalation: null };
    }
    return {
        reply: String(reply)
            .replace(/\n?\[ESKALATION\|[^\]]+\]/g, '')
            .trim(),
        eskalation: {
            kategorie: match[1],
            grund: match[2].trim(),
        },
    };
};

const suggestActions = (userMessage, reply) => {
    const blob = `${userMessage} ${reply}`.toLowerCase();
    const actions = [];
    if (/termin|buch|sperr|frühest|fruehest/.test(blob)) actions.push('termin_buchen');
    if (/verlauf|sitzung|verblass/.test(blob)) actions.push('verlauf');
    if (/nachsorge|heilung|wund|foto.?check/.test(blob)) actions.push('nachsorge');
    if (/studio|kontakt|anrufen/.test(blob)) actions.push('studio_kontakt');
    if (/shop|produkt|salbe/.test(blob)) actions.push('shop');
    return [...new Set(actions)];
};

const normalizeHistory = (history = []) => {
    const cleaned = [];
    let sawUser = false;
    for (const m of history) {
        if (!m?.role || !m?.content) continue;
        if (!sawUser && m.role === 'assistant') continue;
        sawUser = true;
        cleaned.push({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content).slice(0, 4000),
        });
    }
    return cleaned.slice(-10);
};

const fallbackReply = (isStudioUser) =>
    isStudioUser
        ? 'Elaya ist gerade nicht erreichbar. Bitte versuche es später erneut.'
        : 'Ich bin gerade nicht erreichbar. Bitte versuche es später nochmals oder kontaktiere dein Studio direkt.';

// ── POST /chat ────────────────────────────────────────────────────────────
const sendChat = asyncHandler(async (req, res) => {
    const message = req.body.message;
    const history = normalizeHistory(req.body.history);
    const caseId = req.body.case_id || null;
    const focusCustomerId = req.body.customer_id || null;

    if (caseId) {
        const caseDoc = await Case.findById(caseId);
        if (!caseDoc) throw new ApiError(404, 'Case not found');
        await assertCaseAccess(req.user, caseDoc);
    }

    const studioUser = isStudio(req.user.role) || isAdmin(req.user.role);
    const customerUser = isCustomer(req.user.role);

    if (!customerUser && !studioUser) {
        throw new ApiError(403, 'You do not have permission for this action');
    }

    let contextText;
    let systemPrompt;
    let studioCasesOnly = false;

    if (customerUser) {
        systemPrompt = ELAYA_ASSISTANT_SYSTEM;
        contextText = await buildCustomerChatContext(req.user.customer_id, caseId);
    } else {
        systemPrompt = ELAYA_STUDIO_ASSISTANT_SYSTEM;
        const studioId = req.user.studio_id;
        if (!studioId && !isAdmin(req.user.role)) {
            throw new ApiError(400, 'Studio context missing');
        }

        let resolvedCustomerId = focusCustomerId;
        if (!resolvedCustomerId && caseId) {
            const caseDoc = await Case.findById(caseId).select('customer').lean();
            resolvedCustomerId = caseDoc?.customer ? String(caseDoc.customer) : null;
        }

        if (resolvedCustomerId && studioId) {
            const customer = await Customer.findById(resolvedCustomerId)
                .select('aktuelle_firma_id firma_history')
                .lean();
            if (!customer) throw new ApiError(404, 'Customer not found');
            const relation = resolveStudioCustomerRelation(studioId, customer);
            if (relation.wechsel_status === 'none') {
                throw new ApiError(403, 'You do not have access to this customer');
            }
            studioCasesOnly = relation.read_only;
        }

        contextText = studioId
            ? await buildStudioChatContext(studioId, {
                  customerId: resolvedCustomerId,
                  caseId,
                  studioCasesOnly,
              })
            : `Heute: ${new Date().toLocaleDateString('de-CH')}\nAdmin-Modus — kein Studio-Kontext geladen.`;
    }

    if (!isAiEnabled()) {
        return res.status(200).json({
            success: true,
            data: {
                reply: customerUser
                    ? 'Ich bin noch nicht vollständig aktiviert — das Studio kann dich bei Fragen direkt kontaktieren.'
                    : fallbackReply(true),
                suggested_actions: [],
                eskalation: null,
                ai_available: false,
                elaycoins_awarded: 0,
            },
        });
    }

    const profileLabel = customerUser ? 'KUNDENPROFIL' : 'STUDIO-PROFIL';
    let ack = customerUser
        ? 'Verstanden. Ich habe alle Profildaten geladen.'
        : 'Verstanden. Ich habe das Studio-Profil geladen.';
    if (!customerUser && (focusCustomerId || caseId)) {
        ack = 'Verstanden. Ich habe den Fokus-Kunden und die Falldaten geladen.';
    }

    const messages = [
        { role: 'user', content: `${profileLabel}:\n${contextText}` },
        { role: 'assistant', content: ack },
        ...history,
        { role: 'user', content: message },
    ];

    const { text } = await callClaude({
        system: systemPrompt,
        messages,
        maxTokens: 1500,
        expectJson: false,
    });

    const { reply, eskalation } = parseEskalation(text);
    const suggested_actions = customerUser ? suggestActions(message, reply) : [];

    let coinsAwarded = 0;
    if (customerUser) {
        coinsAwarded = await vergebeElaycoins(req.user.customer_id, 'erster_elaya_chat', {
            case_id: caseId,
        });
    }

    res.status(200).json({
        success: true,
        data: {
            reply: reply || fallbackReply(studioUser),
            suggested_actions,
            eskalation,
            ai_available: true,
            elaycoins_awarded: coinsAwarded,
        },
    });
});

module.exports = {
    sendChat,
};

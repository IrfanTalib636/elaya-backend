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
    getCustomerChatPrompt,
    getStudioChatPrompt,
    getCaseFieldGlossary,
    chatLanguage,
} = require('../content/aiPrompts');
const {
    callClaude,
    isAiEnabled,
} = require('../services/anthropicService');
const { getAiSystemPrompt } = require('../utils/aiConfigService');
const { assertAiFeatureAllowed } = require('../utils/aiFeatureGate');
const {
    buildCustomerChatContext,
    buildStudioChatContext,
} = require('../services/chatContextService');
const { vergebeElaycoins } = require('../utils/elaycoinEngine');
const { normalizePreferredLang } = require('../utils/preferredLanguage');

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

const chatCopy = (lang) =>
    lang === 'en'
        ? {
              fallbackStudio: 'Elaya is currently unavailable. Please try again later.',
              fallbackCustomer:
                  "I'm currently unavailable. Please try again later or contact your studio directly.",
              aiOff:
                  "I'm not fully activated yet — the studio can contact you directly if you have questions.",
              ackCustomer: 'Understood. I have loaded all profile data.',
              ackStudio: 'Understood. I have loaded the studio profile.',
              ackFocus: 'Understood. I have loaded the focus customer and case data.',
              profileCustomer: 'CUSTOMER PROFILE',
              profileStudio: 'STUDIO PROFILE',
              adminContext: (date) =>
                  `Today: ${date}\nAdmin mode — no studio context loaded.`,
          }
        : {
              fallbackStudio:
                  'Elaya ist gerade nicht erreichbar. Bitte versuche es später erneut.',
              fallbackCustomer:
                  'Ich bin gerade nicht erreichbar. Bitte versuche es später nochmals oder kontaktiere dein Studio direkt.',
              aiOff:
                  'Ich bin noch nicht vollständig aktiviert — das Studio kann dich bei Fragen direkt kontaktieren.',
              ackCustomer: 'Verstanden. Ich habe alle Profildaten geladen.',
              ackStudio: 'Verstanden. Ich habe das Studio-Profil geladen.',
              ackFocus: 'Verstanden. Ich habe den Fokus-Kunden und die Falldaten geladen.',
              profileCustomer: 'KUNDENPROFIL',
              profileStudio: 'STUDIO-PROFIL',
              adminContext: (date) =>
                  `Heute: ${date}\nAdmin-Modus — kein Studio-Kontext geladen.`,
          };

const fallbackReply = (isStudioUser, lang) => {
    const copy = chatCopy(lang);
    return isStudioUser ? copy.fallbackStudio : copy.fallbackCustomer;
};

// ── POST /chat ────────────────────────────────────────────────────────────
const sendChat = asyncHandler(async (req, res) => {
    const message = req.body.message;
    const history = normalizeHistory(req.body.history);
    const caseId = req.body.case_id || null;
    const focusCustomerId = req.body.customer_id || null;
    const lang = chatLanguage(
        normalizePreferredLang(req.query?.lang) ||
            normalizePreferredLang(req.user?.preferred_language) ||
            'de'
    );
    const copy = chatCopy(lang);
    const glossary = getCaseFieldGlossary(lang);

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

    const languageLock =
        lang === 'en'
            ? 'LANGUAGE LOCK: The selected app language is English. Write the entire reply in English. Do not use German and do not mix languages, even if the user writes German or profile data is in German.'
            : 'SPRACHSPERRE: Die gewählte App-Sprache ist Deutsch. Schreibe die gesamte Antwort auf Deutsch (Schweizer Hochdeutsch, ss statt ß). Verwende kein Englisch und mische keine Sprachen, auch wenn der User Englisch schreibt oder Daten englische Begriffe enthalten.';

    if (customerUser) {
        const basePrompt =
            lang === 'en'
                ? getCustomerChatPrompt('en')
                : (await getAiSystemPrompt('customer_chat')) || ELAYA_ASSISTANT_SYSTEM;
        systemPrompt = `${languageLock}\n\n${basePrompt}`;
        contextText = `${await buildCustomerChatContext(req.user.customer_id, caseId)}\n\n${glossary}`;
    } else {
        const basePrompt =
            lang === 'en'
                ? getStudioChatPrompt('en')
                : (await getAiSystemPrompt('studio_chat')) || ELAYA_STUDIO_ASSISTANT_SYSTEM;
        systemPrompt = `${languageLock}\n\n${basePrompt}`;
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

        const studioContext = studioId
            ? await buildStudioChatContext(studioId, {
                  customerId: resolvedCustomerId,
                  caseId,
                  studioCasesOnly,
              })
            : copy.adminContext(new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-CH'));
        contextText = `${studioContext}\n\n${glossary}`;
    }

    const featureGate = await assertAiFeatureAllowed(
        req.user,
        customerUser ? 'elaya_chat_kunde' : 'ki_studio_assistent'
    );
    if (!featureGate.allowed || !isAiEnabled()) {
        return res.status(200).json({
            success: true,
            data: {
                reply: customerUser ? copy.aiOff : fallbackReply(true, lang),
                suggested_actions: [],
                eskalation: null,
                ai_available: false,
                elaycoins_awarded: 0,
            },
        });
    }

    const profileLabel = customerUser ? copy.profileCustomer : copy.profileStudio;
    let ack = customerUser ? copy.ackCustomer : copy.ackStudio;
    if (!customerUser && (focusCustomerId || caseId)) {
        ack = copy.ackFocus;
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
            reply: reply || fallbackReply(studioUser, lang),
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

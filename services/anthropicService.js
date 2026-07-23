const ApiError = require('../utils/ApiError');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const isAiEnabled = () => {
    if (process.env.AI_ENABLED === 'false') return false;
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
};

const getModel = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

/**
 * Strip markdown fences and parse model JSON output.
 */
const parseJsonFromModelText = (text) => {
    if (!text || typeof text !== 'string') {
        throw new ApiError(502, 'Empty AI response');
    }
    const cleaned = text.replace(/```json|```/gi, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return JSON.parse(cleaned.slice(start, end + 1));
        }
        throw new ApiError(502, 'AI response was not valid JSON');
    }
};

/**
 * Call Claude Messages API (server-side only).
 * @param {{ system: string, messages: object[], maxTokens?: number }} opts
 * @returns {Promise<{ text: string, raw: object, parsed: object|null }>}
 */
const callClaude = async ({ system, messages, maxTokens = 2048, expectJson = true }) => {
    if (!isAiEnabled()) {
        const err = new ApiError(
            503,
            'AI is not configured — set ANTHROPIC_API_KEY (and AI_ENABLED=true) on the server'
        );
        err.code = 'AI_DISABLED';
        throw err;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY.trim();

    const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
            model: getModel(),
            max_tokens: maxTokens,
            system,
            messages,
        }),
    });

    const raw = await response.json().catch(() => ({}));

    if (!response.ok) {
        const msg =
            raw?.error?.message ||
            raw?.message ||
            `Anthropic API error HTTP ${response.status}`;
        const err = new ApiError(502, msg);
        err.code = 'AI_UPSTREAM';
        throw err;
    }

    const text =
        (raw.content || []).find((block) => block.type === 'text')?.text || '';

    let parsed = null;
    if (expectJson) {
        parsed = parseJsonFromModelText(text);
    }

    return { text, raw, parsed };
};

/**
 * Build an image content block from buffer + mime.
 */
const imageContentFromBuffer = (buffer, mimeType = 'image/jpeg') => ({
    type: 'image',
    source: {
        type: 'base64',
        media_type: mimeType,
        data: Buffer.from(buffer).toString('base64'),
    },
});

module.exports = {
    isAiEnabled,
    getModel,
    callClaude,
    parseJsonFromModelText,
    imageContentFromBuffer,
};

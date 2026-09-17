const {
    AiConfig,
    AI_PROMPT_KEYS,
    DEFAULT_AI_PROMPTS,
} = require('../models/aiConfigModel');

const mergePrompts = (stored = {}) => {
    const merged = { ...DEFAULT_AI_PROMPTS };
    for (const key of AI_PROMPT_KEYS) {
        if (typeof stored[key] === 'string' && stored[key].trim()) {
            merged[key] = stored[key];
        }
    }
    return merged;
};

const getAiConfig = async () => {
    let doc = await AiConfig.findOne({ key: 'platform' });
    if (!doc) {
        doc = await AiConfig.create({
            key: 'platform',
            prompts: { ...DEFAULT_AI_PROMPTS },
        });
    }
    const prompts = mergePrompts(doc.prompts);
    return {
        prompts,
        model_name: doc.model_name || 'claude-sonnet-4-20250514',
        updated_at: doc.updatedAt || null,
        updated_by: doc.updated_by || null,
    };
};

const getAiSystemPrompt = async (promptKey) => {
    if (!AI_PROMPT_KEYS.includes(promptKey)) {
        return DEFAULT_AI_PROMPTS.customer_chat;
    }
    const config = await getAiConfig();
    return config.prompts[promptKey] || DEFAULT_AI_PROMPTS[promptKey];
};

const updateAiConfig = async (patch = {}, userId = null) => {
    const doc =
        (await AiConfig.findOne({ key: 'platform' })) ||
        (await AiConfig.create({ key: 'platform', prompts: { ...DEFAULT_AI_PROMPTS } }));

    if (patch.prompts && typeof patch.prompts === 'object') {
        const next = { ...(doc.prompts || {}) };
        for (const key of AI_PROMPT_KEYS) {
            if (typeof patch.prompts[key] === 'string') {
                next[key] = patch.prompts[key];
            }
        }
        doc.prompts = next;
        doc.markModified('prompts');
    }
    if (typeof patch.model_name === 'string' && patch.model_name.trim()) {
        doc.model_name = patch.model_name.trim();
    }
    doc.updated_by = userId;
    await doc.save();
    return getAiConfig();
};

module.exports = {
    getAiConfig,
    getAiSystemPrompt,
    updateAiConfig,
    AI_PROMPT_KEYS,
    DEFAULT_AI_PROMPTS,
};

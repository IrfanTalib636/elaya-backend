const mongoose = require('mongoose');
const {
    ELAYA_NACHSORGE_SYSTEM,
    ELAYA_VERBLASSUNG_SYSTEM,
    ELAYA_ASSISTANT_SYSTEM,
    ELAYA_STUDIO_ASSISTANT_SYSTEM,
} = require('../content/aiPrompts');

const AI_PROMPT_KEYS = [
    'nachsorge',
    'verblassung',
    'customer_chat',
    'studio_chat',
];

const DEFAULT_AI_PROMPTS = {
    nachsorge: ELAYA_NACHSORGE_SYSTEM,
    verblassung: ELAYA_VERBLASSUNG_SYSTEM,
    customer_chat: ELAYA_ASSISTANT_SYSTEM,
    studio_chat: ELAYA_STUDIO_ASSISTANT_SYSTEM,
};

/**
 * Singleton AI runtime config (prompts). Hardcoded prompts remain fallbacks.
 */
const aiConfigSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            default: 'platform',
            unique: true,
            immutable: true,
        },
        prompts: {
            type: mongoose.Schema.Types.Mixed,
            default: () => ({ ...DEFAULT_AI_PROMPTS }),
        },
        model_name: {
            type: String,
            default: 'claude-sonnet-4-20250514',
            trim: true,
            maxlength: 120,
        },
        updated_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

const AiConfig = mongoose.model('AiConfig', aiConfigSchema);

module.exports = {
    AiConfig,
    AI_PROMPT_KEYS,
    DEFAULT_AI_PROMPTS,
};

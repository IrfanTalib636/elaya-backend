const express = require('express');
const aiConfigController = require('../controllers/aiConfigController');
const { protect, authorize } = require('../middleware/authMiddleware');
const validate = require('../middleware/validateMiddleware');
const { z } = require('zod');
const { USER_ROLES } = require('../config/constants');
const { AI_PROMPT_KEYS } = require('../utils/aiConfigService');

const router = express.Router();
const adminRoles = [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.DEVELOPER];

const promptShape = Object.fromEntries(
    AI_PROMPT_KEYS.map((key) => [key, z.string().min(20).max(50000).optional()])
);

const patchSchema = z
    .object({
        prompts: z.object(promptShape).strict().optional(),
        model_name: z.string().trim().min(1).max(120).optional(),
        reason: z.string().max(2000).optional(),
    })
    .strict();

router.get('/', protect, authorize(...adminRoles), aiConfigController.getAiConfigHandler);
router.patch(
    '/',
    protect,
    authorize(...adminRoles),
    validate(patchSchema),
    aiConfigController.patchAiConfigHandler
);

module.exports = router;

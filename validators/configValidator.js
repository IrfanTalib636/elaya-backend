const { z } = require('zod');

const gruppenGroessenSchema = z
    .object({
        klein_max_cm2: z.number().min(0).optional(),
        mittelgross_max_cm2: z.number().min(0).optional(),
        max_punkte: z.number().min(0).optional(),
        gruppen_rabatt: z.number().min(0).max(1).optional(),
    })
    .optional();

const patchPlatformConfigSchema = z
    .object({
        coinWert: z.number().min(0).optional(),
        minWert: z.number().min(0).optional(),
        maxWert: z.number().min(0).optional(),
        deckelProzent: z.number().min(0).max(100).optional(),
        verfallMonate: z.number().min(0).optional(),
        grundgebuehr: z.number().min(0).optional(),
        transaktionsProzent: z.number().min(0).max(100).optional(),
        zahlungszielTage: z.number().min(0).optional(),
        shop_provision_prozent: z.number().min(0).max(100).optional(),
        gruppen_groessen: gruppenGroessenSchema,
        subscription_plans: z.record(z.string(), z.array(z.string())).optional(),
        feature_global: z.record(z.string(), z.boolean()).optional(),
        session_prediction: z
            .object({
                base_sessions: z.number().min(1).max(40).optional(),
                min_sessions: z.number().min(1).max(40).optional(),
                max_sessions: z.number().min(1).max(40).optional(),
                range_minus: z.number().min(0).max(15).optional(),
                range_plus: z.number().min(0).max(15).optional(),
                tattoo_deltas: z.record(z.string(), z.record(z.string(), z.number())).optional(),
                lifestyle_scores: z.record(z.string(), z.record(z.string(), z.number())).optional(),
                lifestyle_bands: z
                    .array(
                        z
                            .object({
                                max_avg: z.number(),
                                score: z.number(),
                                multiplier: z.number().min(0).max(5),
                            })
                            .strict()
                    )
                    .optional(),
                aftercare_extra_max: z.record(z.string(), z.number()).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

const elaycoinStudioCfgSchema = z.record(
    z.string(),
    z
        .object({
            coins: z.number().min(0).optional(),
            aktiv: z.boolean().optional(),
        })
        .strict()
);

const patchStudioConfigSchema = z
    .object({
        coin_wert: z.number().min(0).nullable().optional(),
        studio_pricing: z.record(z.string(), z.number()).optional(),
        elaycoin_studio_cfg: elaycoinStudioCfgSchema.optional(),
        subscription_plan: z.enum(['basic', 'professional', 'enterprise']).optional(),
        feature_overrides: z.record(z.string(), z.boolean()).optional(),
    })
    .strict();

module.exports = {
    patchPlatformConfigSchema,
    patchStudioConfigSchema,
};

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
        gruppen_groessen: gruppenGroessenSchema,
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
    })
    .strict();

module.exports = {
    patchPlatformConfigSchema,
    patchStudioConfigSchema,
};

const { z } = require('zod');

const gruppenGroessenSchema = z
    .object({
        klein_max_cm2: z.number().min(0).optional(),
        mittelgross_max_cm2: z.number().min(0).optional(),
        max_punkte: z.number().min(0).optional(),
        gruppen_rabatt: z.number().min(0).max(1).optional(),
    })
    .optional();

/** Blocking periods in days — ranges match Medical & Safety catalog (prototype). */
const CONDITION_LOCK = z.enum(['MEDICAL_CLEARANCE_REQUIRED', 'MEDICAL_REVIEW_REQUIRED']);

const sperrfristenSchema = z
    .object({
        same_case_tage: z.number().int().min(14).max(180).optional(),
        cross_case_tage: z.number().int().min(7).max(180).optional(),
        uv_mittel_tage: z.number().int().min(0).max(180).optional(),
        uv_intensiv_tage: z.number().int().min(0).max(180).optional(),
        medikament_kurz_tage: z.number().int().min(0).max(180).optional(),
        medikament_retinoide_tage: z.number().int().min(0).max(365).optional(),
        condition_locks: z
            .object({
                antidepressants: CONDITION_LOCK.optional(),
                skin_acne_medication: CONDITION_LOCK.optional(),
                other_unknown_medication: CONDITION_LOCK.optional(),
                illness_not_recovered: CONDITION_LOCK.optional(),
            })
            .strict()
            .optional(),
        studio_exceptions: z
            .record(
                z.string(),
                z
                    .object({
                        date_locks_disabled: z.boolean(),
                        reason: z.string().max(2000).optional().default(''),
                        set_by: z.string().max(200).optional().default(''),
                        set_at: z.string().optional().nullable(),
                    })
                    .strict()
            )
            .optional(),
    })
    .strict()
    .optional();

const terminEinstellungenSchema = z
    .object({
        behandlung_dauer_minuten: z.number().int().min(0).max(1440).optional(),
        beratung_dauer_minuten: z.number().int().min(0).max(1440).optional(),
        gruppen_dauer_minuten: z.number().int().min(0).max(1440).optional(),
        buchung_horizont_tage: z.number().int().min(1).max(3650).optional(),
        min_vorlaufzeit_stunden: z.number().int().min(0).max(8760).optional(),
    })
    .strict()
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
        shop_categories: z.array(z.string().trim().min(1).max(80)).min(1).max(40).optional(),
        shop_shipping: z
            .object({
                Schweiz: z.number().min(0).optional(),
                Deutschland: z.number().min(0).optional(),
                Österreich: z.number().min(0).optional(),
                Frankreich: z.number().min(0).optional(),
                Italien: z.number().min(0).optional(),
                'Andere EU': z.number().min(0).optional(),
                gratis_ab_ch: z.number().min(0).optional(),
                gratis_ab_eu: z.number().min(0).optional(),
            })
            .strict()
            .optional(),
        gruppen_groessen: gruppenGroessenSchema,
        sperrfristen: sperrfristenSchema,
        termin_einstellungen: terminEinstellungenSchema,
        subscription_plans: z.record(z.string(), z.array(z.string())).optional(),
        subscription_seat_limits: z
            .record(z.string(), z.number().int().min(0).nullable())
            .optional(),
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
        /** Platform price calculation defaults (base CHF + multipliers). */
        default_pricing: z.record(z.string(), z.number().min(0).max(100000)).optional(),
    })
    .strict();

const sessionPredictionPreviewSchema = z
    .object({
        preset_id: z.enum(['example_1', 'example_2', 'example_3']).optional(),
        case_input: z.record(z.string(), z.any()).optional(),
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

const pricingPreviewSchema = z
    .object({
        preset_id: z.enum(['example_1', 'example_2', 'example_3']).optional(),
        case_input: z.record(z.string(), z.any()).optional(),
        /**
         * Unsaved pricing values from the settings form. Bounds are deliberately
         * generous — the point of the preview is to show what an odd value does,
         * and `config_check` in the response reports why it is odd.
         */
        studio_pricing: z.record(z.string(), z.number().min(0).max(100000)).optional(),
        /** Admin previewing another studio's pricing. */
        studio_id: z.string().trim().optional(),
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
        gruppen_groessen: gruppenGroessenSchema,
        sperrfristen: sperrfristenSchema,
        termin_einstellungen: terminEinstellungenSchema,
    })
    .strict();

const versionedDomainParam = z.enum([
    'sperrfristen',
    'default_pricing',
    'session_prediction',
]);

const configDraftBodySchema = z
    .object({
        data: z.record(z.string(), z.any()),
        note: z.string().max(2000).optional(),
    })
    .strict();

const configPublishBodySchema = z
    .object({
        reason: z.string().trim().min(1).max(2000),
        /** Optional: publish this payload instead of the saved draft. */
        data: z.record(z.string(), z.any()).optional(),
    })
    .strict();

const configRollbackBodySchema = z
    .object({
        reason: z.string().trim().min(1).max(2000),
    })
    .strict();

module.exports = {
    patchPlatformConfigSchema,
    patchStudioConfigSchema,
    sessionPredictionPreviewSchema,
    pricingPreviewSchema,
    versionedDomainParam,
    configDraftBodySchema,
    configPublishBodySchema,
    configRollbackBodySchema,
};

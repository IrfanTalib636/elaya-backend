const { z } = require('zod');
const { paginationQueryFields } = require('./paginationValidator');

const objectId = z
    .string()
    .trim()
    .min(1)
    .refine((v) => /^[a-fA-F0-9]{24}$/.test(v), { message: 'Invalid id' });

const nachsorgePhotoCheckSchema = z
    .object({
        case_id: objectId,
        foto_file_id: objectId,
        sitzungs_datum: z.coerce.date().optional().nullable(),
    })
    .strict();

const severityEnum = z.enum(['none', 'mild', 'moderate', 'severe']);

const nachsorgeCheckSchema = z
    .object({
        case_id: objectId,
        foto_file_id: objectId,
        symptome: z.array(z.string().trim().min(1)).default([]),
        sitzungs_datum: z.coerce.date().optional().nullable(),
        erythema_level: severityEnum.optional(),
        swelling_level: severityEnum.optional(),
        blistering_flag: z.boolean().optional(),
        crusting_level: severityEnum.optional(),
        pain_score: z.number().min(0).max(10).optional(),
        itching_level: severityEnum.optional(),
        hyperpigmentation_level: severityEnum.optional(),
        hypopigmentation_level: severityEnum.optional(),
        infection_suspected: z.boolean().optional(),
        oozing: z.boolean().optional(),
        warmth: z.boolean().optional(),
        open_lesion: z.boolean().optional(),
        progress_direction_self: z.enum(['better', 'same', 'worse', 'unclear']).optional(),
        concern_flag: z.boolean().optional(),
        sun_avoidance: z.enum(['yes', 'mostly', 'partly', 'no']).optional(),
        spf_use: z.enum(['yes', 'mostly', 'partly', 'no']).optional(),
        aftercare_use: z.enum(['yes', 'mostly', 'partly', 'no']).optional(),
        scratching_behavior: z.enum(['no', 'slightly', 'often']).optional(),
        early_sport_flag: z.enum(['no', 'light_only', 'yes']).optional(),
        current_sleep_quality: z.enum(['poor', 'fair', 'good', 'excellent']).optional(),
        current_stress_level: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
        current_hydration_level: z.enum(['low', 'normal', 'good']).optional(),
        recent_alcohol_excess: z.enum(['no', 'slightly', 'yes']).optional(),
    })
    .strict();

const listNachsorgeQuerySchema = z.object({
    case_id: objectId.optional(),
    ...paginationQueryFields,
});

const nachsorgeReviewSchema = z
    .object({
        studio_review_notes: z.string().trim().max(4000).optional(),
        healing_status: z.enum(['normal', 'monitor', 'conspicuous', 'delayed']).optional(),
    })
    .strict();

module.exports = {
    nachsorgePhotoCheckSchema,
    nachsorgeCheckSchema,
    listNachsorgeQuerySchema,
    nachsorgeReviewSchema,
};

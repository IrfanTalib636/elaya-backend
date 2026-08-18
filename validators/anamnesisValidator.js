const { z } = require('zod');

const jaNein = z.enum(['ja', 'nein']);
const jaNeinUnsicher = z.enum(['ja', 'nein', 'unsicher']);
const diabetesEnum = z.enum(['nein', 'typ1', 'typ2', 'unbekannt']);
const objectId = z.string().regex(/^[a-f\d]{24}$/i);

const anamnesisAnswersSchema = z.object({
    hauterkrankungen: z.array(z.string()).min(1, 'hauterkrankungen is required'),
    hauterkrankungen_andere: z.string().optional().default(''),
    pigmentstoerungen: jaNein,
    akute_erkrankung: jaNein,
    chronische_erkrankungen: jaNein,
    chronische_erkrankungen_text: z.string().optional().default(''),
    diabetes: diabetesEnum,
    autoimmun: jaNein,
    autoimmun_text: z.string().optional().default(''),
    immunschwaeche: jaNein,
    herz_kreislauf: jaNein,
    epilepsie: jaNein,
    blutgerinnung: jaNein,
    blutverduenner: jaNein,
    blutverduenner_text: z.string().optional().default(''),
    infektionskrankheiten: z.array(z.string()).min(1, 'infektionskrankheiten is required'),
    infektionskrankheiten_andere: z.string().optional().default(''),
    allergien: jaNein,
    allergien_text: z.string().optional().default(''),
    wundheilung: jaNein,
    herpes_bereich: jaNein,
    schwanger: jaNeinUnsicher,
    alkohol_drogen: jaNein,
    urteilsfaehig: jaNein,
    mindestalter_18: jaNein,
    ausgefuellt_im_studio: z.boolean().optional(),
    mitarbeiter: z.string().optional(),
});

const bestaetigungSchema = z.object({
    unterschrift_data: z.string().trim().min(40, 'signature is required'),
    name: z.string().trim().max(120).optional().default(''),
});

const upsertAnamnesisSchema = z
    .object({
        antworten: anamnesisAnswersSchema.optional(),
        reuse_previous: z.boolean().optional().default(false),
        gesundheit_unveraendert: z.boolean().optional(),
        previous_case_id: objectId.optional(),
        bestaetigung: bestaetigungSchema.optional(),
    })
    .superRefine((value, ctx) => {
        const unchanged = value.reuse_previous && value.gesundheit_unveraendert === true;
        if (!unchanged && !value.antworten) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'antworten is required unless confirming an unchanged previous check',
                path: ['antworten'],
            });
        }
        if ((value.reuse_previous || value.gesundheit_unveraendert === false) && !value.bestaetigung) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'signature confirmation is required when reusing or updating a previous medical check',
                path: ['bestaetigung'],
            });
        }
    });

const previewAnamnesisSchema = z.object({
    antworten: anamnesisAnswersSchema.partial().optional().default({}),
});

module.exports = {
    upsertAnamnesisSchema,
    previewAnamnesisSchema,
    anamnesisAnswersSchema,
};

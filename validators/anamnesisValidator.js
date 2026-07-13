const { z } = require('zod');

const jaNein = z.enum(['ja', 'nein']);
const jaNeinUnsicher = z.enum(['ja', 'nein', 'unsicher']);
const diabetesEnum = z.enum(['nein', 'typ1', 'typ2', 'unbekannt']);

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

const upsertAnamnesisSchema = z.object({
    antworten: anamnesisAnswersSchema,
});

module.exports = {
    upsertAnamnesisSchema,
    anamnesisAnswersSchema,
};

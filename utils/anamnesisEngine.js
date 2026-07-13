const HAUT_MAP = {
    neurodermitis: 'Neurodermitis',
    psoriasis: 'Psoriasis',
    ekzem: 'Ekzem',
    vitiligo: 'Vitiligo',
    akne: 'Akne',
    herpes: 'Herpes',
    andere: 'Andere',
};

const computeAmpel = (answers = {}) => {
    const orange_fragen = [];
    const rote_fragen = [];

    const hautSel = (answers.hauterkrankungen || []).filter((x) => x !== 'nein');
    if (hautSel.length > 0) {
        orange_fragen.push({
            frage_key: 'hauterkrankungen',
            frage_nr: 1,
            frage_text: 'Hauterkrankungen',
            antwort: hautSel.map((x) => HAUT_MAP[x] || x).join(', '),
        });
    }

    if (answers.pigmentstoerungen === 'ja') {
        orange_fragen.push({
            frage_key: 'pigmentstoerungen',
            frage_nr: 2,
            frage_text: 'Pigmentstörungen',
            antwort: 'Ja',
        });
    }

    if (answers.chronische_erkrankungen === 'ja') {
        orange_fragen.push({
            frage_key: 'chronische_erkrankungen',
            frage_nr: 4,
            frage_text: 'Chronische Erkrankungen',
            antwort: `Ja${answers.chronische_erkrankungen_text ? ` (${answers.chronische_erkrankungen_text})` : ''}`,
        });
    }

    if (answers.allergien === 'ja') {
        orange_fragen.push({
            frage_key: 'allergien',
            frage_nr: 13,
            frage_text: 'Allergien',
            antwort: `Ja${answers.allergien_text ? ` (${answers.allergien_text})` : ''}`,
        });
    }

    if (answers.wundheilung === 'ja') {
        orange_fragen.push({
            frage_key: 'wundheilung',
            frage_nr: 14,
            frage_text: 'Schlechte Wundheilung / Vorherige Behandlungen',
            antwort: 'Ja',
        });
    }

    if (answers.herpes_bereich === 'ja') {
        orange_fragen.push({
            frage_key: 'herpes_bereich',
            frage_nr: 15,
            frage_text: 'Herpes im Bereich',
            antwort: 'Ja',
        });
    }

    if (answers.akute_erkrankung === 'ja') {
        rote_fragen.push({
            frage_key: 'akute_erkrankung',
            frage_nr: 3,
            frage_text: 'Akute Erkrankung / Fieber / Infektion',
            antwort: 'Ja',
        });
    }

    if (['typ1', 'typ2', 'unbekannt'].includes(answers.diabetes)) {
        rote_fragen.push({
            frage_key: 'diabetes',
            frage_nr: 5,
            frage_text: 'Diabetes',
            antwort:
                answers.diabetes === 'typ1'
                    ? 'Ja, Typ 1'
                    : answers.diabetes === 'typ2'
                      ? 'Ja, Typ 2'
                      : 'Weiss ich nicht',
        });
    }

    if (answers.autoimmun === 'ja') {
        rote_fragen.push({
            frage_key: 'autoimmun',
            frage_nr: 6,
            frage_text: 'Autoimmunerkrankung',
            antwort: `Ja${answers.autoimmun_text ? ` (${answers.autoimmun_text})` : ''}`,
        });
    }

    if (answers.immunschwaeche === 'ja') {
        rote_fragen.push({
            frage_key: 'immunschwaeche',
            frage_nr: 7,
            frage_text: 'Immunschwäche',
            antwort: 'Ja',
        });
    }

    if (answers.herz_kreislauf === 'ja') {
        rote_fragen.push({
            frage_key: 'herz_kreislauf',
            frage_nr: 8,
            frage_text: 'Herz-/Kreislauferkrankung',
            antwort: 'Ja',
        });
    }

    if (answers.epilepsie === 'ja') {
        rote_fragen.push({
            frage_key: 'epilepsie',
            frage_nr: 9,
            frage_text: 'Epilepsie / Krampfanfälle',
            antwort: 'Ja',
        });
    }

    if (answers.blutgerinnung === 'ja') {
        rote_fragen.push({
            frage_key: 'blutgerinnung',
            frage_nr: 10,
            frage_text: 'Blutgerinnungsstörung',
            antwort: 'Ja',
        });
    }

    if (answers.schwanger === 'ja') {
        rote_fragen.push({
            frage_key: 'schwanger',
            frage_nr: 16,
            frage_text: 'Schwanger / Stillend',
            antwort: 'Ja',
        });
    }

    if (answers.schwanger === 'unsicher') {
        rote_fragen.push({
            frage_key: 'schwanger',
            frage_nr: 16,
            frage_text: 'Schwangerschaft unsicher',
            antwort: 'Unsicher',
        });
    }

    if (answers.alkohol_drogen === 'ja') {
        rote_fragen.push({
            frage_key: 'alkohol_drogen',
            frage_nr: 17,
            frage_text: 'Unter Alkohol- / Drogeneinfluss',
            antwort: 'Ja',
        });
    }

    if (answers.urteilsfaehig === 'nein') {
        rote_fragen.push({
            frage_key: 'urteilsfaehig',
            frage_nr: 18,
            frage_text: 'Nicht urteilsfähig',
            antwort: 'Ja',
        });
    }

    if (answers.blutverduenner === 'ja') {
        rote_fragen.push({
            frage_key: 'blutverduenner',
            frage_nr: 11,
            frage_text: 'Blutverdünnende Medikamente',
            antwort: `Ja${answers.blutverduenner_text ? ` (${answers.blutverduenner_text})` : ''}`,
        });
    }

    const infektionen = answers.infektionskrankheiten || [];
    const criticalInfekt = infektionen.filter((x) => ['hepatitis', 'hiv'].includes(x));
    if (criticalInfekt.length > 0) {
        rote_fragen.push({
            frage_key: 'infektionskrankheiten',
            frage_nr: 12,
            frage_text: 'Infektionskrankheit (Hepatitis / HIV)',
            antwort: criticalInfekt.map((x) => (x === 'hepatitis' ? 'Hepatitis' : 'HIV')).join(', '),
        });
    }

    const ampel_status =
        rote_fragen.length > 0 ? 'rot' : orange_fragen.length > 0 ? 'orange' : 'gruen';

    return {
        ampel_status,
        orange_fragen,
        rote_fragen,
        orange_keys: orange_fragen.map((f) => f.frage_key),
        rote_keys: rote_fragen.map((f) => f.frage_key),
    };
};

const emptyAnamnesisAnswers = () => ({
    hauterkrankungen: [],
    hauterkrankungen_andere: '',
    pigmentstoerungen: null,
    akute_erkrankung: null,
    chronische_erkrankungen: null,
    chronische_erkrankungen_text: '',
    diabetes: null,
    autoimmun: null,
    autoimmun_text: '',
    immunschwaeche: null,
    herz_kreislauf: null,
    epilepsie: null,
    blutgerinnung: null,
    blutverduenner: null,
    blutverduenner_text: '',
    infektionskrankheiten: [],
    infektionskrankheiten_andere: '',
    allergien: null,
    allergien_text: '',
    wundheilung: null,
    herpes_bereich: null,
    schwanger: null,
    alkohol_drogen: null,
    urteilsfaehig: null,
    mindestalter_18: null,
});

const isAnamnesisComplete = (answers = {}) =>
    !!(
        (answers.hauterkrankungen || []).length > 0 &&
        answers.pigmentstoerungen &&
        answers.akute_erkrankung &&
        answers.chronische_erkrankungen &&
        answers.diabetes &&
        answers.autoimmun &&
        answers.immunschwaeche &&
        answers.herz_kreislauf &&
        answers.epilepsie &&
        answers.blutgerinnung &&
        answers.blutverduenner &&
        (answers.infektionskrankheiten || []).length > 0 &&
        answers.allergien &&
        answers.wundheilung &&
        answers.herpes_bereich &&
        answers.schwanger &&
        answers.alkohol_drogen &&
        answers.urteilsfaehig &&
        answers.mindestalter_18
    );

module.exports = {
    computeAmpel,
    emptyAnamnesisAnswers,
    isAnamnesisComplete,
};

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

const HINT_TEXT = {
    orange: {
        de: '⚠️ Das Studio sieht diese Angabe und wird sich bei Bedarf vor deinem Termin bei dir melden.',
        en: '⚠️ The studio will see this answer and may contact you before your appointment if needed.',
    },
    red: {
        de: '🔴 Das Studio sieht diese Angabe und wird sich vor deinem Termin bei dir melden um alles abzuklären.',
        en: '🔴 The studio will see this answer and contact you before your appointment to clarify.',
    },
    red_ko: {
        akute_erkrankung: {
            de: '🔴 Bei akuter Erkrankung können wir aktuell nicht lasern. Schliesse deinen Case trotzdem ab — beim Terminbuchen wirst du nochmals gefragt ob du genesen bist.',
            en: '🔴 We cannot laser while you have an acute illness. You can still complete your case — you will be asked again when booking.',
        },
        schwanger_ja: {
            de: '🔴 Während Schwangerschaft und Stillzeit können wir nicht lasern. Schliesse deinen Case trotzdem ab — beim Terminbuchen wirst du nochmals gefragt.',
            en: '🔴 We cannot laser during pregnancy or breastfeeding. You can still complete your case — you will be asked again when booking.',
        },
        schwanger_unsicher: {
            de: '🔴 Das Studio wird sich bei dir melden um dies vor dem Termin abzuklären.',
            en: '🔴 The studio will contact you to clarify this before your appointment.',
        },
        alkohol_drogen: {
            de: '🔴 Unter diesem Einfluss ist eine Behandlung nicht möglich. Schliesse deinen Case trotzdem ab — beim Terminbuchen wirst du nochmals gefragt.',
            en: '🔴 Treatment is not possible under this influence. You can still complete your case — you will be asked again when booking.',
        },
        urteilsfaehig: {
            de: '🔴 Schliesse deinen Case trotzdem ab — das Studio wird sich bei dir melden.',
            en: '🔴 You can still complete your case — the studio will contact you.',
        },
        mindestalter_18: {
            de: '🔴 Die Behandlung ist erst ab 18 Jahren möglich. Das Studio wird sich bei dir melden.',
            en: '🔴 Treatment is only possible from age 18. The studio will contact you.',
        },
    },
};

const computeInlineHints = (answers = {}) => {
    const hints = [];
    const ampel = computeAmpel(answers);

    for (const flag of ampel.orange_fragen) {
        hints.push({
            frage_key: flag.frage_key,
            frage_nr: flag.frage_nr,
            level: 'orange',
            text_de: HINT_TEXT.orange.de,
            text_en: HINT_TEXT.orange.en,
        });
    }

    for (const flag of ampel.rote_fragen) {
        let level = 'red';
        let text_de = HINT_TEXT.red.de;
        let text_en = HINT_TEXT.red.en;

        if (flag.frage_key === 'akute_erkrankung') {
            level = 'red_ko';
            text_de = HINT_TEXT.red_ko.akute_erkrankung.de;
            text_en = HINT_TEXT.red_ko.akute_erkrankung.en;
        } else if (flag.frage_key === 'schwanger' && flag.antwort === 'Ja') {
            level = 'red_ko';
            text_de = HINT_TEXT.red_ko.schwanger_ja.de;
            text_en = HINT_TEXT.red_ko.schwanger_ja.en;
        } else if (flag.frage_key === 'schwanger' && flag.antwort === 'Unsicher') {
            level = 'red_ko';
            text_de = HINT_TEXT.red_ko.schwanger_unsicher.de;
            text_en = HINT_TEXT.red_ko.schwanger_unsicher.en;
        } else if (flag.frage_key === 'alkohol_drogen') {
            level = 'red_ko';
            text_de = HINT_TEXT.red_ko.alkohol_drogen.de;
            text_en = HINT_TEXT.red_ko.alkohol_drogen.en;
        } else if (flag.frage_key === 'urteilsfaehig') {
            level = 'red_ko';
            text_de = HINT_TEXT.red_ko.urteilsfaehig.de;
            text_en = HINT_TEXT.red_ko.urteilsfaehig.en;
        }

        hints.push({
            frage_key: flag.frage_key,
            frage_nr: flag.frage_nr,
            level,
            text_de,
            text_en,
        });
    }

    if (answers.mindestalter_18 === 'nein') {
        hints.push({
            frage_key: 'mindestalter_18',
            frage_nr: 19,
            level: 'red_ko',
            text_de: HINT_TEXT.red_ko.mindestalter_18.de,
            text_en: HINT_TEXT.red_ko.mindestalter_18.en,
        });
    }

    const hasKo =
        answers.akute_erkrankung === 'ja' ||
        answers.schwanger === 'ja' ||
        answers.alkohol_drogen === 'ja' ||
        answers.urteilsfaehig === 'nein' ||
        answers.mindestalter_18 === 'nein';

    return { hints, has_ko_flags: hasKo };
};

const computeStudioFreigabe = (answers = {}) => {
    const ausloeser = [];

    if (['typ1', 'typ2', 'unbekannt'].includes(answers.diabetes)) {
        const label =
            answers.diabetes === 'typ1'
                ? 'Diabetes (Typ 1)'
                : answers.diabetes === 'typ2'
                  ? 'Diabetes (Typ 2)'
                  : 'Diabetes (unbekannt)';
        ausloeser.push(label);
    }
    if (answers.autoimmun === 'ja') ausloeser.push('Autoimmunerkrankung');
    if (answers.immunschwaeche === 'ja') ausloeser.push('Immunschwäche');
    if (answers.herz_kreislauf === 'ja') ausloeser.push('Herz-/Kreislauferkrankung');
    if (answers.epilepsie === 'ja') ausloeser.push('Epilepsie');
    if (answers.blutgerinnung === 'ja') ausloeser.push('Blutgerinnungsstörung');
    if (answers.blutverduenner === 'ja') ausloeser.push('Blutverdünnende Medikamente');
    if ((answers.infektionskrankheiten || []).some((x) => ['hepatitis', 'hiv'].includes(x))) {
        ausloeser.push('Infektionskrankheit');
    }
    if (answers.wundheilung === 'ja') ausloeser.push('Schlechte Wundheilung');

    const erforderlich = ausloeser.length > 0;

    return {
        erforderlich,
        status: erforderlich ? 'ausstehend' : 'nicht_erforderlich',
        ausloeser,
        stufe: erforderlich ? '2' : 'keine',
    };
};

const buildAnamnesisSummary = (ampel) => {
    const { ampel_status, orange_fragen, rote_fragen } = ampel;

    return {
        ampel_status,
        gruen: ampel_status === 'gruen',
        orange_block:
            orange_fragen.length > 0
                ? {
                      title_de: '⚠️ Hinweise für das Studio',
                      title_en: '⚠️ Notes for the studio',
                      items: orange_fragen,
                      footer_de:
                          'Die Behandlung ist in der Regel trotzdem möglich. Das Studio ist über deine Angaben informiert.',
                      footer_en:
                          'Treatment is usually still possible. The studio is informed about your answers.',
                  }
                : null,
        rot_block:
            rote_fragen.length > 0
                ? {
                      title_de: '🔴 Das Studio wird sich bei dir melden',
                      title_en: '🔴 The studio will contact you',
                      items: rote_fragen,
                      footer_de:
                          'Das Studio meldet sich so schnell wie möglich per Chat oder Telefon bei dir. Du kannst deinen Termin trotzdem buchen. Bei der Terminbuchung werden diese Punkte nochmals kurz abgefragt.',
                      footer_en:
                          'The studio will contact you as soon as possible. You can still book. These points will be asked again when booking.',
                  }
                : null,
    };
};

const KLAERUNG_STATUS = {
    OFFEN: 'offen',
    IN_KLAERUNG: 'in_klaerung',
    GEKLAERT: 'geklaert',
};

/**
 * Effective ampel after studio klaerung (prototype berechneAmpelStatus).
 * Original rote/orange fragen lists stay immutable — only klaerung changes effective status.
 */
const computeEffectiveAmpel = (roteFragen = [], orangeFragen = [], klaerung = {}) => {
    if (roteFragen.length === 0 && orangeFragen.length === 0) {
        return {
            ampel_status: 'gruen',
            open_medical_flags_count: 0,
        };
    }

    const statusOf = (f) => {
        const entry = klaerung[`F${f.frage_nr}`] || klaerung[f.frage_key];
        return entry?.status || KLAERUNG_STATUS.OFFEN;
    };

    const roteOffen = roteFragen.some((f) => statusOf(f) === KLAERUNG_STATUS.OFFEN);
    if (roteOffen) {
        return {
            ampel_status: 'rot',
            open_medical_flags_count: countOpenFlags(roteFragen, orangeFragen, klaerung),
        };
    }

    const roteInKlaerung = roteFragen.some((f) => statusOf(f) === KLAERUNG_STATUS.IN_KLAERUNG);
    if (roteInKlaerung) {
        return {
            ampel_status: 'orange',
            open_medical_flags_count: countOpenFlags(roteFragen, orangeFragen, klaerung),
        };
    }

    const orangeOffen = orangeFragen.some((f) => statusOf(f) === KLAERUNG_STATUS.OFFEN);
    if (orangeOffen) {
        return {
            ampel_status: 'orange',
            open_medical_flags_count: countOpenFlags(roteFragen, orangeFragen, klaerung),
        };
    }

    const orangeInKlaerung = orangeFragen.some(
        (f) => statusOf(f) === KLAERUNG_STATUS.IN_KLAERUNG
    );
    if (orangeInKlaerung) {
        return {
            ampel_status: 'orange',
            open_medical_flags_count: countOpenFlags(roteFragen, orangeFragen, klaerung),
        };
    }

    return {
        ampel_status: 'gruen',
        open_medical_flags_count: 0,
    };
};

const countOpenFlags = (roteFragen, orangeFragen, klaerung) => {
    const statusOf = (f) => {
        const entry = klaerung[`F${f.frage_nr}`] || klaerung[f.frage_key];
        return entry?.status || KLAERUNG_STATUS.OFFEN;
    };
    return [...roteFragen, ...orangeFragen].filter(
        (f) => statusOf(f) !== KLAERUNG_STATUS.GEKLAERT
    ).length;
};

const klaerungKeyForFlag = (flag) => `F${flag.frage_nr}`;

const buildAnamnesisEvaluation = (answers = {}, klaerung = {}) => {
    const ampel = computeAmpel(answers);
    const { hints, has_ko_flags } = computeInlineHints(answers);
    const studio_freigabe = computeStudioFreigabe(answers);
    const effective = computeEffectiveAmpel(ampel.rote_fragen, ampel.orange_fragen, klaerung);

    return {
        ...ampel,
        ampel_status: effective.ampel_status,
        raw_ampel_status: ampel.ampel_status,
        inline_hints: hints,
        has_ko_flags,
        studio_freigabe,
        summary: buildAnamnesisSummary({
            ...ampel,
            ampel_status: effective.ampel_status,
        }),
        filled: isAnamnesisComplete(answers),
        open_medical_flags_count: effective.open_medical_flags_count,
        klaerung,
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
    computeInlineHints,
    computeStudioFreigabe,
    computeEffectiveAmpel,
    buildAnamnesisSummary,
    buildAnamnesisEvaluation,
    emptyAnamnesisAnswers,
    isAnamnesisComplete,
    KLAERUNG_STATUS,
    klaerungKeyForFlag,
};

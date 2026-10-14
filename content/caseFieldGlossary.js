/**
 * Central case-field definitions. Helper texts in the customer app, studio
 * intake, Case Simulator and ELAYA Chat must stay identical.
 *
 * English copy is the client-approved wording. German is Swiss High German
 * (ss, not ß).
 */

const CASE_FIELD_HELPERS = {
    density: {
        en: 'How densely the tattooed area is filled with pigment — from lightly or loosely covered to very compact and heavily filled.',
        de: 'Wie dicht die tätowierte Fläche mit Pigment gefüllt ist — von leicht oder locker bedeckt bis sehr kompakt und stark gefüllt.',
    },
    saturation: {
        en: 'How intense and strongly deposited the pigment appears within the tattooed areas — from light or faded to highly saturated.',
        de: 'Wie intensiv und stark das Pigment in den tätowierten Flächen liegt — von hell oder verblasst bis stark gesättigt.',
    },
    shading: {
        en: 'How much the tattoo uses shading, gradients, or softly filled areas — from no shading to extensive shading.',
        de: 'Wie stark das Tattoo Schattierung, Verläufe oder weich gefüllte Flächen nutzt — von keiner Schattierung bis ausgedehnter Schattierung.',
    },
    linework: {
        en: 'How the tattoo lines are executed — fine, medium, bold, or a mixture of different line weights.',
        de: 'Wie die Tattoo-Linien ausgeführt sind — fein, mittel, kräftig oder eine Mischung verschiedener Linienstärken.',
    },
};

const CASE_FIELD_LABELS = {
    density: { en: 'Density', de: 'Dichte' },
    saturation: { en: 'Saturation', de: 'Sättigung' },
    shading: { en: 'Shading', de: 'Schattierung' },
    linework: { en: 'Line style', de: 'Linienführung' },
};

const UNKNOWN_OPTION = {
    value: 'unknown',
    en: 'Not sure',
    de: 'Nicht sicher',
};

const helperBlock = (lang) => {
    const loc = lang === 'en' ? 'en' : 'de';
    return Object.keys(CASE_FIELD_HELPERS)
        .map((key) => `${CASE_FIELD_LABELS[key][loc]}: ${CASE_FIELD_HELPERS[key][loc]}`)
        .join('\n');
};

const CASE_FIELD_GLOSSARY_DE = `CASE-FELDER (dieselben Definitionen wie die Hilfetexte in der App):
${helperBlock('de')}

«Nicht sicher» ist eine eigene auswählbare Antwort (Wert: unknown). Sie wird nicht automatisch als Mittel und nicht als Stellvertreter für einen anderen Wert gelesen. Wenn ein Kunde unsicher ist, soll er diese Option wählen.`;

const CASE_FIELD_GLOSSARY_EN = `CASE FIELDS (same definitions as the in-app helper texts):
${helperBlock('en')}

"Not sure" is its own selectable answer (value: unknown). It is not automatically treated as Medium and not used as a stand-in for another value. If a customer is unsure, they should choose this option.`;

const CASE_FIELD_GLOSSARY = `${CASE_FIELD_GLOSSARY_EN}

${CASE_FIELD_GLOSSARY_DE}`;

module.exports = {
    CASE_FIELD_HELPERS,
    CASE_FIELD_LABELS,
    UNKNOWN_OPTION,
    CASE_FIELD_GLOSSARY_DE,
    CASE_FIELD_GLOSSARY_EN,
    CASE_FIELD_GLOSSARY,
};

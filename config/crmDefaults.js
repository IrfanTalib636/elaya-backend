const CRM_TASK_TYP = {
    FOLLOWUP: 'followup',
    ANRUF: 'anruf',
    EMAIL: 'email',
    TERMIN: 'termin',
    SONSTIGES: 'sonstiges',
};

const CRM_TASK_PRIORITAET = {
    NIEDRIG: 'niedrig',
    MITTEL: 'mittel',
    HOCH: 'hoch',
};

const CRM_NOTE_TYP = {
    ANRUF: 'anruf',
    EMAIL: 'email',
    MEETING: 'meeting',
    SONSTIGES: 'sonstiges',
};

/** Default recommended action per pipeline stage (Neu is overridden when cases exist). */
const CRM_STAGE_AKTION = {
    Neu: 'Ersten Fall anlegen',
    'Beratung geplant': 'Termin bestätigen',
    'Behandlung aktiv': 'Nächsten Termin planen',
    'Beratung erledigt': 'Follow-up senden',
};

/** Context-aware action — Neu + existing case(s) → book consultation, not create case. */
const getStageAktion = (pipelineStufe, totalCases = 0) => {
    if (pipelineStufe === 'Neu' && totalCases > 0) {
        return 'Beratung terminieren';
    }
    return CRM_STAGE_AKTION[pipelineStufe] ?? '';
};

/** Chat/message templates per pipeline stage (copy-to-clipboard in UI) */
const getLeadTemplate = (pipelineStufe, vorname, totalCases = 0) => {
    const name = vorname?.trim() || 'Kunde';

    if (pipelineStufe === 'Neu' && totalCases > 0) {
        return `Hallo ${name}! Dein Fall ist angelegt. Buche jetzt deinen Beratungstermin – wir freuen uns auf dich!`;
    }

    const templates = {
        Neu: `Hallo ${name}! Willkommen bei uns. Erstelle deinen ersten Fall, damit wir deinen Behandlungsweg gemeinsam planen können.`,
        'Beratung geplant': `Hallo ${name}! Erinnerung: Dein Beratungstermin steht bald an. Wir freuen uns auf dich!`,
        'Behandlung aktiv': `Hallo ${name}! Wie läuft deine Behandlung? Sollen wir den nächsten Termin reservieren?`,
        'Beratung erledigt': `Hallo ${name}! Deine Beratung ist abgeschlossen. Wann möchtest du mit der Behandlung starten?`,
    };
    return templates[pipelineStufe] ?? '';
};

module.exports = {
    CRM_TASK_TYP,
    CRM_TASK_PRIORITAET,
    CRM_NOTE_TYP,
    CRM_STAGE_AKTION,
    getStageAktion,
    getLeadTemplate,
};

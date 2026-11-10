/** German strings for booking pre-session check (PS_01). */
module.exports = {
    ps01: {
        title: 'Kurz-Check vor dem Termin',
        subtitle: 'Dauert nur 30 Sekunden. Pflicht vor jeder Behandlung.',
        medicationQuestion: 'Hast du in den letzten 6 Monaten Medikamente eingenommen?',
    },
    uv: {
        keine: 'Keine',
        leicht: 'Leicht',
        mittel: 'Mittel',
        intensiv: 'Intensiv',
    },
    meds: {
        keine: 'Keine / keine Medikamente',
        antibiotika: 'Antibiotika',
        antidepressiva: 'Antidepressiva',
        retinoide: 'Retinoide',
    },
    noticeLabels: {
        uvIntensiv: 'intensive UV-Exposition',
        uvMittel: 'mittlere UV-Exposition',
        retinoide: 'Retinoide',
        antibiotika: 'Antibiotika',
        antidepressiva: 'Antidepressiva',
    },
    notices: {
        inactive: 'Keine aktive Sperrfrist für {{label}}.',
        active: 'Sperrfrist {{days}} Tage — Behandlung frühestens am {{earliest}} buchbar.',
    },
    blocks: {
        mindestalter_18:
            'Die Behandlung ist erst ab 18 Jahren möglich. Bitte kontaktiere das Studio.',
        studio_clarification:
            'Medizinische Abklärung durch das Studio ist erforderlich. Du kannst den Termin trotzdem buchen — das Studio kontaktiert dich vor der Behandlung und trifft die endgültige Entscheidung.',
        pre_session_incomplete: 'Bitte beantworte alle Pflichtfragen im Kurz-Check.',
        wiederholungen_incomplete: 'Bitte bestätige alle Rückfragen zur Anamnese.',
        ko_signature_required: 'Bitte unterschreibe zur Bestätigung deiner geänderten Angaben.',
        anamnesis_required: 'Bitte schliesse zuerst die medizinische Anamnese ab.',
        medical_clearance_required:
            'Für die Behandlung ist eine ärztliche Freigabe (Attest) nötig. Bitte lade das Dokument hoch — dein Studio prüft nur, ob eine passende Bestätigung vorliegt. Beratungen bleiben buchbar.',
    },
    ko: {
        mindestalter_18: {
            frageText: 'Mindestalter 18',
        },
        schwanger: {
            frageText: 'Schwangerschaft / Stillzeit',
            optionChanged: 'Ja, nicht mehr schwanger/stillend',
            optionStill: 'Nein, bin noch schwanger/stillend',
            recoveryOriginal: 'Schwanger/stillend',
            recoveryNeu: 'Nicht mehr schwanger/stillend',
            activityLabel: 'Schwangerschaft',
        },
        akute_erkrankung: {
            frageText: 'Akute Erkrankung',
            optionChanged: 'Ja, bin genesen',
            optionStill: 'Nein, bin noch krank',
            recoveryOriginal: 'Akut krank',
            recoveryNeu: 'Von akuter Erkrankung genesen',
            activityLabel: 'Akute Erkrankung',
        },
        alkohol_drogen: {
            frageText: 'Alkohol / Drogen',
            optionChanged: 'Nein, nicht mehr',
            optionStill: 'Ja, stimmt noch',
            recoveryOriginal: 'Unter Einfluss',
            recoveryNeu: 'Nicht mehr unter Einfluss',
            activityLabel: 'Alkohol/Drogen',
        },
        urteilsfaehig: {
            frageText: 'Urteilsfähigkeit',
            optionChanged: 'Ja, bin jetzt urteilsfähig',
            optionStill: 'Nein, stimmt noch',
            recoveryOriginal: 'Nicht urteilsfähig',
            recoveryNeu: 'Urteilsfähigkeit wiederhergestellt',
            activityLabel: 'Urteilsfähigkeit',
        },
    },
    activity: {
        recheckSame: 'Rückfrage: {{text}} → Ja, stimmt noch',
        recheckChanged: 'Rückfrage: {{text}} → Nein, hat sich geändert',
        koChanged: 'Rückfrage: {{label}} → Hat sich geändert',
        koUnchanged: 'Rückfrage: {{label}} → Unverändert',
    },
};

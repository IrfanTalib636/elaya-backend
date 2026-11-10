/** English strings for booking pre-session check (PS_01). */
module.exports = {
    ps01: {
        title: 'Pre-session check',
        subtitle: 'Takes about 30 seconds. Required before every treatment.',
        medicationQuestion: 'Have you taken any medications in the last 6 months?',
    },
    uv: {
        keine: 'None',
        leicht: 'Light',
        mittel: 'Moderate',
        intensiv: 'Intense',
    },
    meds: {
        keine: 'None / no medications',
        antibiotika: 'Antibiotics',
        antidepressiva: 'Antidepressants',
        retinoide: 'Retinoids',
    },
    noticeLabels: {
        uvIntensiv: 'intense UV exposure',
        uvMittel: 'moderate UV exposure',
        retinoide: 'retinoids',
        antibiotika: 'antibiotics',
        antidepressiva: 'antidepressants',
    },
    notices: {
        inactive: 'No active blocking period for {{label}}.',
        active: 'Blocking period {{days}} days — earliest treatment {{earliest}}.',
    },
    blocks: {
        mindestalter_18:
            'Treatment is only possible from age 18. Please contact the studio.',
        studio_clarification:
            'Medical/studio clarification is required. You can still book — the studio will contact you before treatment and make the final decision.',
        pre_session_incomplete: 'Please answer all required questions in the pre-session check.',
        wiederholungen_incomplete: 'Please confirm all anamnesis follow-up questions.',
        ko_signature_required: 'Please sign to confirm your updated answers.',
        anamnesis_required: 'Please complete the medical anamnesis first.',
        medical_clearance_required:
            "A doctor's certificate is required before treatment. Please upload it — your studio only verifies that an appropriate confirmation exists. Consultation appointments stay bookable.",
    },
    ko: {
        mindestalter_18: {
            frageText: 'Minimum age 18',
        },
        schwanger: {
            frageText: 'Pregnancy / breastfeeding',
            optionChanged: 'Yes, no longer pregnant/breastfeeding',
            optionStill: 'No, still pregnant/breastfeeding',
            recoveryOriginal: 'Pregnant/breastfeeding',
            recoveryNeu: 'No longer pregnant/breastfeeding',
            activityLabel: 'Pregnancy',
        },
        akute_erkrankung: {
            frageText: 'Acute illness',
            optionChanged: 'Yes, recovered',
            optionStill: 'No, still ill',
            recoveryOriginal: 'Acutely ill',
            recoveryNeu: 'Recovered from acute illness',
            activityLabel: 'Acute illness',
        },
        alkohol_drogen: {
            frageText: 'Alcohol / drugs',
            optionChanged: 'No, not anymore',
            optionStill: 'Yes, still applies',
            recoveryOriginal: 'Under influence',
            recoveryNeu: 'No longer under influence',
            activityLabel: 'Alcohol/drugs',
        },
        urteilsfaehig: {
            frageText: 'Decision-making capacity',
            optionChanged: 'Yes, capable again',
            optionStill: 'No, still applies',
            recoveryOriginal: 'Not capable',
            recoveryNeu: 'Decision-making capacity restored',
            activityLabel: 'Decision-making capacity',
        },
    },
    activity: {
        recheckSame: 'Follow-up: {{text}} → Yes, still applies',
        recheckChanged: 'Follow-up: {{text}} → No, has changed',
        koChanged: 'Follow-up: {{label}} → Has changed',
        koUnchanged: 'Follow-up: {{label}} → Unchanged',
    },
};

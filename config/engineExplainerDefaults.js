/**
 * Default Super Admin copy for “How ELAYA works”.
 * Placeholders are filled from the published (or draft) Engine config so the
 * wording cannot drift from the real formula.
 *
 * Super Admin can edit this copy (DRAFT → Publish). Numbers always come from
 * session_prediction + default_pricing.
 */

const EN = {
    title: 'How does ELAYA work?',
    liveDraft: {
        title: 'Live and Draft',
        liveTitle: 'Live',
        liveText:
            'Live is the published Engine. The studio, the customer app, ELAYA Chat and the AI Training Center all use these values.',
        draftTitle: 'Draft',
        draftText:
            'Draft is editable. Changing a value does not change Live. Publish is what makes the Draft become the new Live.',
        controls:
            'Reset draft throws away unpublished edits and returns to the published Live values. Price rules and session-prediction rules each have their own draft — publishing one does not publish the other.',
        split:
            'You edit the numbers in Pricing, Base & range, Colours & laser, Fitzpatrick & skin, Lifestyle, and Healing & response. This page is the explanation. Versions & audit shows both domains.',
        impact:
            'The Impact preview on the right runs the same sample case twice: once with published Live values and once with the pending Draft. Live and Draft are identical only while there are no Draft changes. As soon as a value is changed, Live stays as published and Draft shows the new calculated result.',
    },
    delta: {
        title: 'What is a delta and how much is it worth?',
        intro: 'A delta (+/−) means extra sessions or fewer sessions compared with the base.',
        ruleTitle: 'Basic rule',
        plus: 'Δ+1 = about 1 more session at a normal lifestyle (multiplier ×1.00)',
        minus: 'Δ−1 = about 1 fewer session at a normal lifestyle (multiplier ×1.00)',
        importantLabel: 'Important:',
        important:
            'The lifestyle multiplier applies to the TOTAL number of sessions (base + all deltas), not only to an individual delta.',
        exampleTitle: 'Example',
        rawLabel: 'Raw value',
        conclusionTitle: 'Conclusion',
        conclusionIntro: 'If you raise a delta by +1:',
        conclusionEmphasis: 'The worse the customer’s lifestyle, the more every delta change counts.',
    },
    calc: {
        title: 'How the calculation works',
        priceTitle: 'Price per session',
        priceRule:
            'Price per session = MAX(minimum price {{min_price}} CHF, area cm² × {{price_per_cm2}} CHF), rounded up to the next CHF {{price_round_to}}.',
        priceColors: 'Colours do NOT affect the price. They only affect the session count.',
        sessionsTitle: 'Session count',
        sessionsText:
            'Base ({{base_sessions}}) + all deltas = raw value. Raw value × lifestyle multiplier = centre (rounded, then clamped between {{min_sessions}} and {{max_sessions}}). Range: centre − {{range_minus}} to centre + {{range_plus}}{{aftercare_note}}.',
        whatTitle: 'What are deltas?',
        whatIntro: 'Each factor adds or subtracts sessions:',
        colorImpact:
            'With several colours, Color Impact = {{color_aggregation_rule}}. Those two are not simply added unless the Engine is set to sum.',
        exampleTitle: 'Example',
        costTitle: 'Total cost',
        effectTitle: 'Effect of a delta change',
        effectIntro: 'If you raise one tattoo delta by +1:',
        effectEmphasis: 'The higher the lifestyle multiplier, the more every delta change counts.',
    },
    lifestyle: {
        title: 'How the lifestyle index is calculated',
        step1Lead: '1. Each factor gives a score',
        step1Scale: '(1 = very good, 5 = very bad)',
        step2: '2. Average of all present factors = composite score',
        step3: '3. The composite score is looked up against the thresholds below (editable in Lifestyle):',
        exampleTitle: 'Example',
        bmiNote:
            'BMI floors can only raise the composite score, never lower it. The thresholds are configured in Lifestyle.',
    },
    aiTitle: 'Link to ELAYA Chat and the AI Training Center',
    aiText:
        'ELAYA Chat and the AI Training Center always read the published Live Engine (this explanation, the delta values, and the version number). Changing a Draft does not change what the AI uses until you Publish. Automatic model retraining is not yet active — the AI uses the current published configuration as its source of truth.',
}

const DE = {
    title: 'Wie funktioniert ELAYA?',
    liveDraft: {
        title: 'Live und Draft',
        liveTitle: 'Live',
        liveText:
            'Live ist die veröffentlichte Engine. Studio, Kunden-App, ELAYA Chat und das AI Training Center verwenden diese Werte.',
        draftTitle: 'Draft',
        draftText:
            'Draft ist editierbar. Eine Änderung ändert Live nicht. Erst „Veröffentlichen“ macht den Draft zum neuen Live.',
        controls:
            'Draft zurücksetzen verwirft unveröffentlichte Änderungen und stellt die veröffentlichten Live-Werte wieder her. Preisregeln und Sitzungsprognose haben je einen eigenen Draft — das Veröffentlichen des einen veröffentlicht den anderen nicht.',
        split:
            'Die Zahlen bearbeitest du unter Preise, Basis & Bereich, Farben & Laser, Fitzpatrick & Haut, Lifestyle und Healing & Response. Diese Seite ist die Erklärung. Versionen & Audit zeigt beide Bereiche.',
        impact:
            'Die Impact-Vorschau rechts rechnet denselben Beispiel-Case zweimal: einmal mit den veröffentlichten Live-Werten und einmal mit dem ausstehenden Draft. Live und Draft sind nur identisch, solange es keine Draft-Änderungen gibt. Sobald ein Wert geändert wird, bleibt Live unverändert und Draft zeigt das neu berechnete Ergebnis.',
    },
    delta: {
        title: 'Was ist ein Delta und wieviel ist es wert?',
        intro: 'Ein Delta (+/−) bedeutet: zusätzliche oder weniger Sitzungen im Vergleich zur Basis.',
        ruleTitle: 'Grundregel',
        plus: 'Δ+1 = ca. 1 Sitzung mehr bei normalem Lifestyle (Multiplikator ×1.00)',
        minus: 'Δ−1 = ca. 1 Sitzung weniger bei normalem Lifestyle (Multiplikator ×1.00)',
        importantLabel: 'Wichtig:',
        important:
            'Der Lifestyle-Multiplikator wirkt auf die GESAMTZAHL aller Sitzungen (Basis + alle Deltas), nicht nur auf einzelne Deltas.',
        exampleTitle: 'Beispiel',
        rawLabel: 'Rohwert',
        conclusionTitle: 'Fazit',
        conclusionIntro: 'Wenn du einen Delta um +1 erhöhst:',
        conclusionEmphasis:
            'Je schlechter der Lifestyle des Kunden, desto stärker wirkt sich jede Delta-Änderung aus.',
    },
    calc: {
        title: 'Wie die Berechnung funktioniert',
        priceTitle: 'Preis pro Sitzung',
        priceRule:
            'Preis pro Sitzung = MAX(Mindestpreis {{min_price}} CHF, Fläche cm² × {{price_per_cm2}} CHF), aufgerundet auf die nächsten CHF {{price_round_to}}.',
        priceColors: 'Farben beeinflussen den Preis NICHT. Sie beeinflussen nur die Sitzungsanzahl.',
        sessionsTitle: 'Sitzungsanzahl',
        sessionsText:
            'Basis ({{base_sessions}}) + alle Deltas = Rohwert. Rohwert × Lifestyle-Multiplikator = Mitte (gerundet, begrenzt auf {{min_sessions}}–{{max_sessions}}). Range: Mitte − {{range_minus}} bis Mitte + {{range_plus}}{{aftercare_note}}.',
        whatTitle: 'Was sind Deltas?',
        whatIntro: 'Jeder Faktor addiert oder subtrahiert Sitzungen:',
        colorImpact:
            'Bei mehreren Farben gilt: Color Impact = {{color_aggregation_rule}}. Diese beiden werden nicht einfach addiert, ausser die Engine ist auf Summe gestellt.',
        exampleTitle: 'Beispiel',
        costTitle: 'Gesamtkosten',
        effectTitle: 'Einfluss einer Delta-Änderung',
        effectIntro: 'Wenn du ein Tattoo-Delta um +1 erhöhst:',
        effectEmphasis:
            'Je höher der Lifestyle-Multiplikator, desto mehr wirkt sich jede Delta-Änderung aus.',
    },
    lifestyle: {
        title: 'Wie der Lifestyle-Index berechnet wird',
        step1Lead: '1. Jeder Faktor gibt einen Score',
        step1Scale: '(1 = sehr gut, 5 = sehr schlecht)',
        step2: '2. Durchschnitt aller vorhandenen Faktoren = Composite Score',
        step3: '3. Der Composite Score wird in den Schwellen unten nachgeschlagen (editierbar unter Lifestyle):',
        exampleTitle: 'Beispiel',
        bmiNote:
            'BMI-Mindestwerte können den Composite Score nur anheben, nie senken. Die Schwellen konfigurierst du unter Lifestyle.',
    },
    aiTitle: 'Verbindung zu ELAYA Chat und AI Training Center',
    aiText:
        'ELAYA Chat und das AI Training Center lesen immer die veröffentlichte Live-Engine (diese Erklärung, die Delta-Werte und die Versionsnummer). Ein Draft ändert nicht, was die KI verwendet, bis du veröffentlichst. Automatisches Modell-Training ist noch nicht aktiv — die KI nutzt die aktuelle veröffentlichte Konfiguration als einzige Quelle.',
}

const DEFAULT_ENGINE_EXPLAINER = {
    en: EN,
    de: DE,
}

const deepMerge = (base, override) => {
    if (!override || typeof override !== 'object' || Array.isArray(override)) {
        return base;
    }
    const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
    for (const [key, value] of Object.entries(override)) {
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            typeof out[key] === 'object'
        ) {
            out[key] = deepMerge(out[key], value);
        } else if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
};

const mergeEngineExplainer = (stored = {}) => ({
    en: deepMerge(EN, stored.en || {}),
    de: deepMerge(DE, stored.de || {}),
});

module.exports = {
    DEFAULT_ENGINE_EXPLAINER,
    mergeEngineExplainer,
}

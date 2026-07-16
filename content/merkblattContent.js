/**
 * TC_08 Merkblatt — aftercare text (prototype MERKBLATT_TEXT, plain text for API/mobile).
 */
const MERKBLATT_SECTIONS = {
    de: [
        {
            id: 'intro',
            title: 'NACHSORGE NACH IHRER LASERBEHANDLUNG',
            paragraphs: [],
        },
        {
            id: 'first_7_days',
            title: 'ERSTE 7 TAGE — WAS SIE TUN SOLLTEN',
            paragraphs: [
                'Kühlen Sie die behandelte Stelle sofort nach der Behandlung und wiederholen Sie dies regelmässig in den ersten 48 Stunden (Cool-Pack, nie Eis direkt auf die Haut). Sprühen Sie das Areal täglich mehrmals mit Octenisept® ein, tupfen Sie es trocken und decken Sie es mit Metalline-Kompressen® ab. Das Areal muss trocken, aber nicht luftdicht abgedeckt sein.',
                'Tragen Sie in den ersten 7 Tagen mehrmals täglich TattooMed® Laser Aftercare L1 AKUT dünn auf. Falls sich eine Kompresse festgetrocknet hat: mit Octenisept® einsprühen, einweichen lassen, vorsichtig ablösen.',
                'Ab dem 3. Tag darf das Areal mit klarem Wasser (keine Seife) gewaschen werden. Danach mit Octenisept® desinfizieren und L1 AKUT dünn auftragen.',
                'Ab der 2. Woche: TattooMed® Laser Aftercare L2 SKIN REPAIR, 2–3× täglich.',
            ],
        },
        {
            id: 'avoid',
            title: 'WAS SIE UNBEDINGT VERMEIDEN MÜSSEN',
            paragraphs: [
                'UV-Strahlung (Sonne, Solarium) 4 Wochen vor und 4–8 Wochen nach der Behandlung meiden. Schutz: TattooMed® L3 PROTECT mit LSF 30.',
                'Krusten, Schorf und Blasen niemals kratzen oder aufstechen — Jucken ist normal und gehört zum Heilungsprozess.',
                'Für 7 Tage: kein Kraftsport, keine starken Muskelkontraktionen.',
                'Für 3 Wochen: keine Sauna, keine Vollbäder, keine Peelings, keine Cremes oder Make-up im behandelten Bereich.',
                'Keine fettreichen Salben (Vaseline, Melkfett, Penaten) — sie blockieren den Pigmentabtransport.',
                'Rauchen verlangsamt die Heilung erheblich.',
            ],
        },
        {
            id: 'normal',
            title: 'NORMALE REAKTIONEN — KEIN GRUND ZUR SORGE',
            paragraphs: [
                'Jucken, Rötungen, Brennen, leichte Schwellungen: entstehen durch die Laserenergie — bei Bedarf kühlen.',
                'Blasenbildung: enthält schützendes Gewebewasser — kühlen, eincremen, desinfizieren, nie aufstechen.',
                'Kleine Blutungen: vorsichtig abtupfen und desinfizieren.',
            ],
        },
        {
            id: 'support',
            title: 'WAS DEN HEILUNGSPROZESS UNTERSTÜTZT',
            paragraphs: [
                'Viel trinken (Wasser, Kräutertee, Ananassaft).',
                'Ausgewogen essen — Obst und Gemüse stärken das Immunsystem.',
                'Ausreichend schlafen.',
            ],
        },
    ],
    en: [
        {
            id: 'intro',
            title: 'AFTERCARE FOLLOWING YOUR LASER TREATMENT',
            paragraphs: [],
        },
        {
            id: 'first_7_days',
            title: 'FIRST 7 DAYS — WHAT YOU SHOULD DO',
            paragraphs: [
                'Cool the treated area immediately after treatment and repeat regularly in the first 48 hours (cool pack, never ice directly on skin). Spray the area several times daily with Octenisept®, pat dry and cover with Metalline® compresses. The area must stay dry but not airtight.',
                'Apply TattooMed® Laser Aftercare L1 ACUTE thinly several times daily for the first 7 days. If a compress has dried on: spray with Octenisept®, soak, remove carefully.',
                'From day 3 the area may be washed with clear water (no soap). Disinfect with Octenisept® and apply L1 ACUTE thinly.',
                'From week 2: TattooMed® Laser Aftercare L2 SKIN REPAIR, 2–3× daily.',
            ],
        },
        {
            id: 'avoid',
            title: 'WHAT YOU MUST AVOID',
            paragraphs: [
                'Avoid UV (sun, tanning beds) 4 weeks before and 4–8 weeks after treatment. Use TattooMed® L3 PROTECT SPF 30.',
                'Never scratch or puncture scabs, crusts or blisters — itching is normal during healing.',
                'For 7 days: no intense sport or strong muscle contractions.',
                'For 3 weeks: no sauna, full baths, peels, creams or make-up on the treated area.',
                'No greasy ointments (Vaseline, etc.) — they block pigment clearance.',
                'Smoking significantly slows healing.',
            ],
        },
        {
            id: 'normal',
            title: 'NORMAL REACTIONS — NO CAUSE FOR CONCERN',
            paragraphs: [
                'Itching, redness, burning, mild swelling: caused by laser energy — cool if needed.',
                'Blisters: contain protective fluid — cool, cream, disinfect, never puncture.',
                'Minor bleeding: dab carefully and disinfect.',
            ],
        },
        {
            id: 'support',
            title: 'WHAT SUPPORTS HEALING',
            paragraphs: [
                'Drink plenty of fluids (water, herbal tea, pineapple juice).',
                'Eat balanced meals — fruit and vegetables support the immune system.',
                'Get enough sleep.',
            ],
        },
    ],
};

const MERKBLATT_LABELS = {
    de: {
        checkbox_merkblatt:
            'Ich habe die Nachsorgehinweise vollständig gelesen und verstanden.',
        confirmation_text:
            'Ich bestätige, dass alle gemachten Angaben zu meiner Person und meinem Tattoo/PMU wahrheitsgemäss und vollständig sind. Ich habe die Nachsorgehinweise gelesen und werde diese befolgen. Mir ist bewusst, dass sich mein Gesundheitszustand ändern kann und ich das Studio vor jedem Termin über relevante Änderungen informieren muss.',
        confirmation_anamnesis_extra:
            'Ich bestätige ausserdem, dass ich alle Fragen der medizinischen Anamnese wahrheitsgemäss und vollständig beantwortet habe. Mir ist bewusst, dass falsche Angaben die Behandlung gefährden und die Haftung bei mir liegt.',
        footer_contact:
            'Bei Fragen wende dich an dein Studio. Dieses Merkblatt wurde digital erstellt.',
    },
    en: {
        checkbox_merkblatt: 'I have read and understood the aftercare instructions in full.',
        confirmation_text:
            'I confirm that all information about me and my tattoo/PMU is truthful and complete. I have read the aftercare instructions and will follow them. I understand my health may change and I will inform the studio before each appointment.',
        confirmation_anamnesis_extra:
            'I also confirm that I answered all medical anamnesis questions truthfully and completely. I understand false information may endanger treatment and liability rests with me.',
        footer_contact: 'Contact your studio with questions. This document was created digitally.',
    },
};

const getMerkblattContent = (locale = 'de') => {
    const lang = locale === 'en' ? 'en' : 'de';
    return {
        locale: lang,
        sections: MERKBLATT_SECTIONS[lang],
        labels: MERKBLATT_LABELS[lang],
    };
};

module.exports = {
    MERKBLATT_SECTIONS,
    MERKBLATT_LABELS,
    getMerkblattContent,
};

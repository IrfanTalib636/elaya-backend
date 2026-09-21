/**
 * Prototype Automatisierungen defaults (elaya_automatisierungen).
 * Platform-admin catalog of automatic customer message rules.
 * Send/trigger logic is separate — this store only defines who may edit what.
 */

const R = (
    id,
    kategorie,
    label_de,
    label_en,
    beschreibung_de,
    beschreibung_en,
    aktiv,
    hat_tage_feld,
    tage_wert,
    tage_min,
    tage_max
) => ({
    id,
    kategorie,
    label_de,
    label_en,
    beschreibung_de,
    beschreibung_en,
    aktiv: aktiv !== false,
    hat_tage_feld: !!hat_tage_feld,
    tage_wert: hat_tage_feld ? tage_wert : null,
    tage_min: hat_tage_feld ? tage_min : null,
    tage_max: hat_tage_feld ? tage_max : null,
    editierbar_studio: true,
});

const DEFAULT_AUTOMATISIERUNGEN = {
    version: 1,
    kategorien: [
        {
            id: 'A',
            label_de: 'A — Onboarding',
            label_en: 'A — Onboarding',
            regeln: [
                R(
                    'A1_willkommen',
                    'A',
                    'Willkommensnachricht',
                    'Welcome message',
                    'Sofort bei erster App-Öffnung nach Registrierung',
                    'Immediately on first app open after registration',
                    true,
                    false
                ),
                R(
                    'A2_kein_case',
                    'A',
                    'Kein Case angelegt',
                    'No case created',
                    'Erinnerung wenn nach X Tagen kein Case existiert',
                    'Reminder if no case exists after X days',
                    true,
                    true,
                    3,
                    1,
                    30
                ),
                R(
                    'A3_kein_termin',
                    'A',
                    'Kein Termin gebucht',
                    'No appointment booked',
                    'Erinnerung nach Anamnese ohne Terminbuchung',
                    'Reminder after anamnesis without booking',
                    true,
                    true,
                    2,
                    1,
                    14
                ),
            ],
        },
        {
            id: 'B',
            label_de: 'B — Termine',
            label_en: 'B — Appointments',
            regeln: [
                R(
                    'B1_termin_1tag',
                    'B',
                    'Termin-Erinnerung 24h',
                    'Appointment reminder 24h',
                    'Automatische Erinnerung 24h vor dem Termin',
                    'Automatic reminder 24h before the appointment',
                    true,
                    false
                ),
                R(
                    'B2_termin_2h',
                    'B',
                    'Termin-Erinnerung 2h',
                    'Appointment reminder 2h',
                    'Sofort-Erinnerung 2 Stunden vor dem Termin',
                    'Instant reminder 2 hours before the appointment',
                    false,
                    false
                ),
                R(
                    'B3_presession',
                    'B',
                    'Pre-Session Check',
                    'Pre-session check',
                    'UV-Schutz und Medikamenten-Hinweis 1–2 Tage vor Termin',
                    'UV protection and medication note 1–2 days before appointment',
                    true,
                    false
                ),
            ],
        },
        {
            id: 'C',
            label_de: 'C — Nachsorge',
            label_en: 'C — Aftercare',
            regeln: [
                R(
                    'C1_nachsorge_tag1',
                    'C',
                    'Nachsorge Tag 1',
                    'Aftercare day 1',
                    'Pflegehinweise am Tag nach der Behandlung',
                    'Care instructions the day after treatment',
                    true,
                    false
                ),
                R(
                    'C2_nachsorge_tag3',
                    'C',
                    'Nachsorge Tag 3',
                    'Aftercare day 3',
                    'Zwischencheck nach 3 Tagen Heilungsphase',
                    'Interim check after 3 days of healing',
                    true,
                    false
                ),
                R(
                    'C3_nachsorge_tag7',
                    'C',
                    'Nachsorge Tag 7',
                    'Aftercare day 7',
                    'Wochenkontrolle und Sonnenschutzhinweis',
                    'Weekly check and sun protection note',
                    true,
                    false
                ),
                R(
                    'C4_heilung_ok',
                    'C',
                    'Heilung abgeschlossen',
                    'Healing completed',
                    'Benachrichtigung nach 42 Tagen — bereit für nächste Sitzung',
                    'Notification after 42 days — ready for next session',
                    true,
                    false
                ),
            ],
        },
        {
            id: 'D',
            label_de: 'D — Nächste Sitzung',
            label_en: 'D — Next Session',
            regeln: [
                R(
                    'D1_naechste_bereit',
                    'D',
                    'Bereit für nächste Sitzung',
                    'Ready for next session',
                    'Wenn 49-Tage-Sperrfrist abgelaufen und kein Termin gebucht',
                    'When the 49-day lock has passed and no appointment is booked',
                    true,
                    false
                ),
                R(
                    'D2_naechste_erinnerung',
                    'D',
                    'Termin-Erinnerung (kein Termin)',
                    'Appointment reminder (no booking)',
                    'X Tage nach Bereitschaft ohne Buchung',
                    'X days after readiness without booking',
                    true,
                    true,
                    7,
                    1,
                    30
                ),
            ],
        },
        {
            id: 'E',
            label_de: 'E — Re-Aktivierung',
            label_en: 'E — Re-activation',
            regeln: [
                R(
                    'E1_reaktivierung_60',
                    'E',
                    'Inaktiv seit 60 Tagen',
                    'Inactive for 60 days',
                    'Reaktivierungsnachricht nach 60 Tagen ohne Aktivität',
                    'Re-activation message after 60 days of inactivity',
                    true,
                    false
                ),
                R(
                    'E2_reaktivierung_90',
                    'E',
                    'Inaktiv seit 90 Tagen',
                    'Inactive for 90 days',
                    'Zweite Reaktivierungsnachricht nach 90 Tagen Inaktivität',
                    'Second re-activation message after 90 days of inactivity',
                    true,
                    false
                ),
            ],
        },
        {
            id: 'F',
            label_de: 'F — Shop',
            label_en: 'F — Shop',
            regeln: [
                R(
                    'F1_shop_tag2',
                    'F',
                    'Shop-Empfehlung Tag 2',
                    'Shop recommendation day 2',
                    'Produktempfehlung 2 Tage nach Behandlung',
                    'Product recommendation 2 days after treatment',
                    true,
                    false
                ),
                R(
                    'F2_shop_tag5',
                    'F',
                    'Shop-Empfehlung Tag 5',
                    'Shop recommendation day 5',
                    'Nachsorge-Produkt Erinnerung nach 5 Tagen',
                    'Aftercare product reminder after 5 days',
                    true,
                    false
                ),
                R(
                    'F3_shop_sonnenschutz',
                    'F',
                    'Sonnenschutz-Kampagne',
                    'Sun protection campaign',
                    'Saisonale Empfehlung April–September',
                    'Seasonal recommendation April–September',
                    false,
                    false
                ),
            ],
        },
    ],
};

const cloneAutomations = (src = DEFAULT_AUTOMATISIERUNGEN) =>
    JSON.parse(JSON.stringify(src));

module.exports = {
    DEFAULT_AUTOMATISIERUNGEN,
    cloneAutomations,
};

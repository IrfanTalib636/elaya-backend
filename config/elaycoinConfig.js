const ELAYCOIN_COIN_GELDWERT = 100;
const ELAYCOIN_CHF_PRO_EINHEIT = 5;
const ELAYCOIN_TAGESLIMIT = 800;
const ELAYCOIN_MIN = 0;
const ELAYCOIN_MAX = 1000;
const COIN_VERFALL_MONATE = 12;

const ELAYCOIN_SITUATIONS = [
    { key: 'termin_wahrgenommen', label: 'Termin wahrgenommen', kat: 'BEHANDLUNGSTREUE', coins: 100, aktiv: true, einmalig: false },
    { key: 'sitzung_meilenstein_3', label: 'Meilenstein: 3. Sitzung', kat: 'BEHANDLUNGSTREUE', coins: 150, aktiv: true, einmalig: true },
    { key: 'sitzung_meilenstein_5', label: 'Meilenstein: 5. Sitzung', kat: 'BEHANDLUNGSTREUE', coins: 250, aktiv: true, einmalig: true },
    { key: 'sitzung_meilenstein_10', label: 'Meilenstein: 10. Sitzung', kat: 'BEHANDLUNGSTREUE', coins: 500, aktiv: true, einmalig: true },
    { key: 'behandlung_abgeschlossen', label: 'Behandlung abgeschlossen', kat: 'BEHANDLUNGSTREUE', coins: 500, aktiv: true, einmalig: true },
    { key: 'fruehbucher', label: 'Frühbucher-Bonus', kat: 'BEHANDLUNGSTREUE', coins: 50, aktiv: true, einmalig: false },
    { key: 'heilungsfoto_hochgeladen', label: 'Heilungsfoto hochgeladen', kat: 'NACHSORGE', coins: 80, aktiv: true, einmalig: false, limitProSitzung: 1 },
    { key: 'nachsorge_check', label: 'Nachsorge-Check eingereicht', kat: 'NACHSORGE', coins: 50, aktiv: true, einmalig: false, limitTage: 7 },
    { key: 'nachsorge_serie', label: 'Nachsorge-Serie (3 Checks)', kat: 'NACHSORGE', coins: 120, aktiv: true, einmalig: false },
    { key: 'ki_training_freigabe', label: 'KI-Training freigegeben', kat: 'NACHSORGE', coins: 100, aktiv: true, einmalig: true },
    { key: 'anamnese_vollstaendig', label: 'Anamnese vollständig', kat: 'GESUNDHEIT', coins: 100, aktiv: true, einmalig: true },
    { key: 'lifestyle_update', label: 'Lifestyle-Update', kat: 'GESUNDHEIT', coins: 30, aktiv: true, einmalig: false, limitTage: 30 },
    { key: 'erster_einkauf', label: 'Erster Einkauf', kat: 'SHOP', coins: 150, aktiv: true, einmalig: true },
    { key: 'nachsorge_produkt_gekauft', label: 'Nachsorge-Produkt gekauft', kat: 'SHOP', coins: 40, aktiv: true, einmalig: false },
    {
        key: 'shop_einloesung',
        label: 'Elaycoins im Shop eingelöst',
        kat: 'SHOP',
        coins: 0,
        aktiv: true,
        istMalus: true,
    },
    { key: 'admin_korrektur', label: 'Admin-Korrektur', kat: 'ADMIN', coins: 0, aktiv: true, einmalig: false },
    { key: 'freund_geworben', label: 'Freund geworben', kat: 'WACHSTUM', coins: 500, aktiv: true, einmalig: false },
    { key: 'bewertung_geschrieben', label: 'Bewertung geschrieben', kat: 'WACHSTUM', coins: 200, aktiv: true, einmalig: true },
    { key: 'story_geteilt', label: 'Story geteilt', kat: 'WACHSTUM', coins: 150, aktiv: true, einmalig: true },
    { key: 'profil_vervollstaendigt', label: 'Profil vervollständigt', kat: 'ENGAGEMENT', coins: 50, aktiv: true, einmalig: true },
    { key: 'erster_elaya_chat', label: 'Erster Elaya-Chat', kat: 'ENGAGEMENT', coins: 30, aktiv: true, einmalig: true },
    { key: 'jubilaeum_1_jahr', label: '1-Jahres-Jubiläum', kat: 'ENGAGEMENT', coins: 200, aktiv: true, einmalig: false, limitTage: 365 },
    { key: 'no_show', label: 'Nicht erschienen', kat: 'ABZÜGE', coins: 150, aktiv: true, istMalus: true },
    {
        key: 'kurzfristige_stornierung',
        label: 'Nicht rechtzeitig storniert (< 24h)',
        kat: 'ABZÜGE',
        coins: 80,
        aktiv: true,
        istMalus: true,
    },
];

const ELAYCOIN_SITUATION_MAP = Object.fromEntries(ELAYCOIN_SITUATIONS.map((s) => [s.key, s]));

module.exports = {
    ELAYCOIN_COIN_GELDWERT,
    ELAYCOIN_CHF_PRO_EINHEIT,
    ELAYCOIN_TAGESLIMIT,
    ELAYCOIN_MIN,
    ELAYCOIN_MAX,
    COIN_VERFALL_MONATE,
    ELAYCOIN_SITUATIONS,
    ELAYCOIN_SITUATION_MAP,
};

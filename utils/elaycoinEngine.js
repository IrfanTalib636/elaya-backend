const mongoose = require('mongoose');
const Customer = require('../models/customerModel');
const Session = require('../models/sessionModel');
const Appointment = require('../models/appointmentModel');
const Case = require('../models/caseModel');
const Studio = require('../models/studioModel');
const {
    ELAYCOIN_COIN_GELDWERT,
    ELAYCOIN_CHF_PRO_EINHEIT,
    ELAYCOIN_TAGESLIMIT,
    ELAYCOIN_MIN,
    ELAYCOIN_MAX,
    ELAYCOIN_SITUATION_MAP,
} = require('../config/elaycoinConfig');
const { getPlatformConfig, resolveEffectiveCoinWert } = require('./configService');

const txCoins = (t) => t.coins ?? t.betrag ?? 0;

/** Only real MongoDB appointment IDs go on appointment_id; composite keys stay in kontext.apt_id */
const toAppointmentObjectId = (aptId) => {
    if (!aptId) {
        return null;
    }
    const s = aptId.toString();
    if (mongoose.Types.ObjectId.isValid(s) && String(new mongoose.Types.ObjectId(s)) === s) {
        return s;
    }
    return null;
};

const isSameCalendarDay = (a, b) => {
    const d1 = new Date(a);
    const d2 = new Date(b);
    return (
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate()
    );
};

const coinsToChf = (balance, coinWert = ELAYCOIN_CHF_PRO_EINHEIT / ELAYCOIN_COIN_GELDWERT) =>
    Math.round(Math.max(0, balance) * coinWert * 100) / 100;

const getEffectiveSituation = (key, studioOverrides = {}) => {
    const def = ELAYCOIN_SITUATION_MAP[key];
    if (!def) {
        return null;
    }
    return { ...def, ...(studioOverrides[key] || {}) };
};

const recalculateBalance = (transactions) =>
    Math.max(ELAYCOIN_MIN, transactions.reduce((sum, t) => sum + txCoins(t), 0));

const ensureElaycoins = (customer) => {
    if (!customer.elaycoins) {
        customer.elaycoins = { balance: 0, transactions: [], gesendete_warnungen: [] };
    }
    if (!Array.isArray(customer.elaycoins.transactions)) {
        customer.elaycoins.transactions = [];
    }
    if (!Array.isArray(customer.elaycoins.gesendete_warnungen)) {
        customer.elaycoins.gesendete_warnungen = [];
    }
};

const hasMalusForApt = (transactions, malusKey, aptId) =>
    transactions.some(
        (t) =>
            t.situationKey === malusKey &&
            (t.appointment_id?.toString() === aptId ||
                t.kontext?.apt_id === aptId ||
                t.kontext?.apt_id?.toString() === aptId)
    );

const resolveStudioMeta = (studio, kontext = {}) => ({
    herkunft_studio_id: studio?._id?.toString() || kontext.herkunft_studio_id || '',
    herkunft_studio_name: studio?.firma || kontext.herkunft_studio_name || '',
});

async function berechneLetzteAktivitaet(customerId) {
    let latest = null;
    const consider = (val) => {
        if (!val) {
            return;
        }
        const d = new Date(val);
        if (!Number.isNaN(d.getTime()) && (!latest || d > latest)) {
            latest = d;
        }
    };

    const [sessions, appointments, cases] = await Promise.all([
        Session.find({ customer: customerId, treatment_date: { $ne: null } })
            .select('treatment_date')
            .lean(),
        Appointment.find({ customer: customerId }).select('date createdAt').lean(),
        Case.find({ customer: customerId }).select('createdAt').lean(),
    ]);

    sessions.forEach((s) => consider(s.treatment_date));
    appointments.forEach((a) => consider(a.date || a.createdAt));
    cases.forEach((c) => consider(c.createdAt));

    if (!latest) {
        latest = new Date();
    }

    return latest;
}

function resolveWarnstufe(tageBis, forStudio) {
    if (tageBis < 0) {
        return 'abgelaufen';
    }
    if (forStudio) {
        return tageBis <= 60 ? 'warnung' : 'keine';
    }
    if (tageBis <= 1) {
        return 'kritisch_1tag';
    }
    if (tageBis <= 3) {
        return 'kritisch_3tage';
    }
    if (tageBis <= 30) {
        return 'warnung_1monat';
    }
    if (tageBis <= 60) {
        return 'warnung_2monate';
    }
    if (tageBis <= 120) {
        return 'warnung_4monate';
    }
    return 'keine';
}

async function getCoinVerfallStatus(customerId, { forStudio = false, studioId = null } = {}) {
    const [customer, platform] = await Promise.all([
        Customer.findById(customerId).select('elaycoins.balance').lean(),
        getPlatformConfig(),
    ]);
    const balance = customer?.elaycoins?.balance ?? 0;
    const letzteAktivitaet = await berechneLetzteAktivitaet(customerId);
    const verfallMonate = platform.verfallMonate;

    const verfaelltAm = new Date(letzteAktivitaet.getTime());
    verfaelltAm.setMonth(verfaelltAm.getMonth() + verfallMonate);

    const heute = new Date();
    heute.setHours(0, 0, 0, 0);
    const va = new Date(verfaelltAm.getTime());
    va.setHours(0, 0, 0, 0);
    const tageBis = Math.round((va - heute) / (24 * 3600 * 1000));

    return {
        balance,
        letzteAktivitaet,
        verfaelltAm,
        tageBis,
        warnstufe: resolveWarnstufe(tageBis, forStudio),
    };
}

function coinVerfallNachrichtText(stufe, balance, verfaelltAm) {
    const X = balance;
    const Y = coinsToChf(balance);
    const D = verfaelltAm.toLocaleDateString('de-CH');
    switch (stufe) {
        case 'warnung_4monate':
            return `Kleiner Hinweis zu deinen Elaycoins 🦙\n\nDu hast aktuell ${X} Elaycoins (≈ CHF ${Y}.—). Damit sie nicht verfallen, bleib einfach aktiv – zum Beispiel mit einem Nachsorge-Check oder deinem nächsten Termin. Sonst wären sie am ${D} fällig. Noch ist aber viel Zeit!`;
        case 'warnung_2monate':
            return `Erinnerung zu deinen Elaycoins 🦙\n\nDeine ${X} Elaycoins (≈ CHF ${Y}.—) verfallen am ${D}, wenn du bis dahin nicht aktiv bist. Ein Nachsorge-Check, ein Termin oder ein Einkauf hält dein Guthaben frisch. Schade um die Coins, oder?`;
        case 'warnung_1monat':
            return `Deine Elaycoins laufen bald ab ⏳\n\nDu hast ${X} Elaycoins (≈ CHF ${Y}.—). Sie verfallen am ${D} – also in rund einem Monat. Buch dir einen Termin oder mach einen Nachsorge-Check, dann bleiben deine Coins erhalten.`;
        case 'kritisch_3tage':
            return `🚨 Deine Elaycoins verfallen in wenigen Tagen!\n\n${X} Elaycoins (≈ CHF ${Y}.—) sind nur noch bis zum ${D} gültig. Werd jetzt aktiv – ein Nachsorge-Check oder eine Terminbuchung genügt, damit dein Guthaben nicht verloren geht.`;
        case 'kritisch_1tag':
            return `🚨 Letzte Chance für deine Elaycoins!\n\nDeine ${X} Elaycoins (≈ CHF ${Y}.—) verfallen schon am ${D}. Sichere sie dir jetzt mit einer kurzen Aktivität in der App – sonst sind sie weg.`;
        case 'abgelaufen':
            return `Deine Elaycoins sind verfallen 😔\n\nLeider sind deine ${X} Elaycoins (≈ CHF ${Y}.—) am ${D} nach 12 Monaten Inaktivität verfallen. Kein Problem – du kannst sofort wieder neue sammeln: mit jedem Termin, Nachsorge-Check oder Einkauf wächst dein Guthaben erneut. 🦙`;
        default:
            return '';
    }
}

async function pruefeCoinVerfallUndBenachrichtigungen(customerId) {
    const customer = await Customer.findById(customerId);
    if (!customer) {
        return { changed: false };
    }

    ensureElaycoins(customer);
    const status = await getCoinVerfallStatus(customerId);
    const { verfaelltAm, warnstufe } = status;
    const balance = customer.elaycoins.balance || 0;
    let pendingMessage = null;

    if (warnstufe === 'abgelaufen' && balance > 0) {
        customer.elaycoins.transactions.push({
            situationKey: 'coins_verfallen',
            label: 'Elaycoins verfallen (12 Monate Inaktivität)',
            kat: 'VERFALL',
            coins: -balance,
            typ: 'verfall',
            datum: new Date(),
        });
        customer.elaycoins.balance = 0;

        if (!customer.elaycoins.gesendete_warnungen.includes('abgelaufen')) {
            customer.elaycoins.gesendete_warnungen.push('abgelaufen');
            pendingMessage = coinVerfallNachrichtText('abgelaufen', balance, verfaelltAm);
        }

        customer.markModified('elaycoins');
        await customer.save();
        return { changed: true, expired: true, amount: balance, pendingMessage, status };
    }

    if (warnstufe !== 'keine' && warnstufe !== 'abgelaufen' && balance > 0) {
        if (!customer.elaycoins.gesendete_warnungen.includes(warnstufe)) {
            customer.elaycoins.gesendete_warnungen.push(warnstufe);
            pendingMessage = coinVerfallNachrichtText(warnstufe, balance, verfaelltAm);
            customer.markModified('elaycoins');
            await customer.save();
            return { changed: true, pendingMessage, status };
        }
    }

    return { changed: false, status };
}

async function vergebeElaycoins(customerId, situationKey, kontext = {}, options = {}) {
    const sit = getEffectiveSituation(situationKey, options.studioOverrides);
    if (!sit || sit.istMalus) {
        return 0;
    }
    if (!sit.aktiv) {
        return 0;
    }

    const coins = Math.max(ELAYCOIN_MIN, Math.min(ELAYCOIN_MAX, sit.coins));
    const customer = await Customer.findById(customerId);
    if (!customer) {
        return 0;
    }

    ensureElaycoins(customer);
    await pruefeCoinVerfallUndBenachrichtigungen(customerId);

    const fresh = await Customer.findById(customerId);
    ensureElaycoins(fresh);

    const txs = fresh.elaycoins.transactions;
    const caseId = kontext.case_id?.toString?.() || kontext.case_id || null;

    const heuteCoins = txs
        .filter((t) => isSameCalendarDay(t.datum, new Date()) && txCoins(t) > 0)
        .reduce((sum, t) => sum + txCoins(t), 0);

    if (heuteCoins + coins > ELAYCOIN_TAGESLIMIT) {
        return 0;
    }

    if (sit.einmalig) {
        const already = caseId
            ? txs.some((t) => t.situationKey === situationKey && t.case_id?.toString() === caseId)
            : txs.some((t) => t.situationKey === situationKey);
        if (already) {
            return 0;
        }
    }

    if (sit.limitTage) {
        const cutoff = new Date(Date.now() - sit.limitTage * 24 * 3600 * 1000);
        const relevant = caseId
            ? txs.filter(
                  (t) => t.situationKey === situationKey && t.case_id?.toString() === caseId
              )
            : txs.filter((t) => t.situationKey === situationKey);
        if (relevant.some((t) => new Date(t.datum) >= cutoff)) {
            return 0;
        }
    }

    if (sit.limitProSitzung && kontext.session_id) {
        const sid = kontext.session_id;
        if (
            txs.some(
                (t) =>
                    t.situationKey === situationKey &&
                    (t.session_id === sid || t.kontext?.session_id === sid)
            )
        ) {
            return 0;
        }
    }

    const studioMeta = resolveStudioMeta(options.studio, kontext);
    const tx = {
        situationKey,
        label: sit.label,
        kat: sit.kat,
        coins,
        typ: 'reward',
        datum: new Date(),
        case_id: kontext.case_id || null,
        session_id: kontext.session_id || null,
        appointment_id: toAppointmentObjectId(kontext.apt_id),
        kontext,
        ...studioMeta,
    };

    fresh.elaycoins.transactions.push(tx);
    fresh.elaycoins.balance = recalculateBalance(fresh.elaycoins.transactions);
    fresh.markModified('elaycoins');
    await fresh.save();

    return coins;
}

async function zieheElaycoinsAb(customerId, malusKey, kontext = {}, options = {}) {
    const sit = getEffectiveSituation(malusKey, options.studioOverrides);
    if (!sit || !sit.istMalus) {
        return 0;
    }
    if (!sit.aktiv) {
        return 0;
    }

    const override =
        options.amountOverride != null
            ? Number(options.amountOverride)
            : kontext.coins != null
              ? Number(kontext.coins)
              : null;
    const abzugBetrag = Math.max(
        ELAYCOIN_MIN,
        Math.min(
            ELAYCOIN_MAX,
            Number.isFinite(override) && override > 0 ? override : sit.coins
        )
    );
    const customer = await Customer.findById(customerId);
    if (!customer) {
        return 0;
    }

    ensureElaycoins(customer);
    await pruefeCoinVerfallUndBenachrichtigungen(customerId);

    const fresh = await Customer.findById(customerId);
    ensureElaycoins(fresh);
    const txs = fresh.elaycoins.transactions;

    const aptId = kontext.apt_id?.toString?.() || kontext.apt_id || null;
    if (aptId && hasMalusForApt(txs, malusKey, aptId)) {
        return 0;
    }

    const tatsaechlich = Math.min(abzugBetrag, fresh.elaycoins.balance || 0);
    if (tatsaechlich <= 0) {
        return 0;
    }

    const studioMeta = resolveStudioMeta(options.studio, kontext);
    const tx = {
        situationKey: malusKey,
        label: sit.label,
        kat: sit.kat,
        coins: -tatsaechlich,
        typ: 'malus',
        datum: new Date(),
        case_id: kontext.case_id || null,
        session_id: kontext.session_id || null,
        appointment_id: toAppointmentObjectId(aptId),
        kontext: { ...kontext, apt_id: aptId },
        ...studioMeta,
    };

    fresh.elaycoins.transactions.push(tx);
    fresh.elaycoins.balance = Math.max(0, (fresh.elaycoins.balance || 0) - tatsaechlich);
    fresh.markModified('elaycoins');
    await fresh.save();

    return tatsaechlich;
}

async function getElaycoinData(
    customerId,
    { applyExpiry = true, forStudio = false, studioId = null } = {}
) {
    if (applyExpiry) {
        await pruefeCoinVerfallUndBenachrichtigungen(customerId);
    }

    const [customer, platform, coinWert] = await Promise.all([
        Customer.findById(customerId).select('elaycoins').lean(),
        getPlatformConfig(),
        resolveEffectiveCoinWert(studioId),
    ]);
    if (!customer) {
        return null;
    }

    const ec = customer.elaycoins || { balance: 0, transactions: [], gesendete_warnungen: [] };
    const expiry = await getCoinVerfallStatus(customerId, { forStudio, studioId });

    return {
        balance: ec.balance || 0,
        chf_estimate: coinsToChf(ec.balance || 0, coinWert),
        transactions: ec.transactions || [],
        gesendete_warnungen: ec.gesendete_warnungen || [],
        expiry,
        platform: {
            coin_geldwert: ELAYCOIN_COIN_GELDWERT,
            chf_pro_einheit: ELAYCOIN_CHF_PRO_EINHEIT,
            coin_wert: coinWert,
            tageslimit: ELAYCOIN_TAGESLIMIT,
            min: ELAYCOIN_MIN,
            max: ELAYCOIN_MAX,
            deckel_prozent: platform.deckelProzent,
            verfall_monate: platform.verfallMonate,
        },
    };
}

const isKurzfristigeAenderung = (appointmentDate) => {
    const apt = new Date(appointmentDate);
    if (Number.isNaN(apt.getTime())) {
        return false;
    }
    const msUntil = apt.getTime() - Date.now();
    return msUntil > 0 && msUntil < 24 * 3600 * 1000;
};

async function applyKurzfristigeStornierungMalusIfNeeded(appointment) {
    if (!isKurzfristigeAenderung(appointment.date)) {
        return 0;
    }

    const studio = await Studio.findById(appointment.studio).select('firma').lean();
    return zieheElaycoinsAb(
        appointment.customer,
        'kurzfristige_stornierung',
        {
            case_id: appointment.case,
            kunde_id: appointment.customer,
            apt_id: appointment._id.toString(),
        },
        { studio }
    );
}

async function processNewSessionElaycoins(session, caseDoc) {
    if (session.is_draft) {
        return;
    }

    const studio = await Studio.findById(session.studio).select('firma elaycoin_studio_cfg').lean();
    const studioOverrides = studio?.elaycoin_studio_cfg || {};
    const options = { studio, studioOverrides };

    const kontext = {
        case_id: caseDoc._id,
        session_id: session.session_id,
        kunde_id: caseDoc.customer,
    };

    if (session.is_no_show) {
        const aptId = session.appointment
            ? session.appointment.toString()
            : `${caseDoc._id}_no_show_${session.treatment_date?.toISOString?.()?.slice(0, 10)}`;

        await zieheElaycoinsAb(
            caseDoc.customer,
            'no_show',
            { ...kontext, apt_id: aptId },
            options
        );
        return;
    }

    await vergebeElaycoins(caseDoc.customer, 'termin_wahrgenommen', kontext, options);

    const refreshed = await Case.findById(caseDoc._id).select('sessionsDone sessions').lean();
    const newDone = refreshed?.sessionsDone ?? 0;
    const plannedSessions = refreshed?.sessions || 99;

    if (newDone === 3) {
        await vergebeElaycoins(caseDoc.customer, 'sitzung_meilenstein_3', kontext, options);
    }
    if (newDone === 5) {
        await vergebeElaycoins(caseDoc.customer, 'sitzung_meilenstein_5', kontext, options);
    }
    if (newDone === 10) {
        await vergebeElaycoins(caseDoc.customer, 'sitzung_meilenstein_10', kontext, options);
    }
    if (newDone >= plannedSessions) {
        await vergebeElaycoins(caseDoc.customer, 'behandlung_abgeschlossen', kontext, options);
    }
}

async function processNoShowMalus(session, caseDoc) {
    if (session.is_draft) {
        return;
    }

    const studio = await Studio.findById(session.studio).select('firma elaycoin_studio_cfg').lean();
    const aptId = session.appointment
        ? session.appointment.toString()
        : `${caseDoc._id}_no_show_${session.treatment_date?.toISOString?.()?.slice(0, 10)}`;

    await zieheElaycoinsAb(
        caseDoc.customer,
        'no_show',
        {
            case_id: caseDoc._id,
            session_id: session.session_id,
            kunde_id: caseDoc.customer,
            apt_id: aptId,
        },
        { studio, studioOverrides: studio?.elaycoin_studio_cfg || {} }
    );
}

async function processFinalizedSessionElaycoins(session, caseDoc) {
    await processNewSessionElaycoins(session, caseDoc);
}

module.exports = {
    ELAYCOIN_COIN_GELDWERT,
    ELAYCOIN_CHF_PRO_EINHEIT,
    ELAYCOIN_TAGESLIMIT,
    coinsToChf,
    getEffectiveSituation,
    berechneLetzteAktivitaet,
    getCoinVerfallStatus,
    coinVerfallNachrichtText,
    pruefeCoinVerfallUndBenachrichtigungen,
    vergebeElaycoins,
    zieheElaycoinsAb,
    getElaycoinData,
    isKurzfristigeAenderung,
    applyKurzfristigeStornierungMalusIfNeeded,
    processNewSessionElaycoins,
    processNoShowMalus,
    processFinalizedSessionElaycoins,
};

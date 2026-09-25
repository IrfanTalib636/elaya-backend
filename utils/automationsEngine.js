/**
 * Automations engine — prototype `pruefeAutomatisierungen` parity + declarative triggers.
 *
 * Known rule ids (A1…F3) keep built-in conditions.
 * New Admin-created rules work via `rule.trigger.type` without code changes.
 * Delivery: in-app inbox + Expo push (best effort).
 */

const Customer = require('../models/customerModel');
const Appointment = require('../models/appointmentModel');
const Case = require('../models/caseModel');
const Session = require('../models/sessionModel');
const Anamnesis = require('../models/anamnesisModel');
const Studio = require('../models/studioModel');
const User = require('../models/userModel');
const { APPOINTMENT_STATUS } = require('../config/constants');
const {
    getPlatformConfig,
    mergeEffectiveAutomations,
} = require('./configService');
const { createForUsers } = require('../services/notificationService');
const { sendToUsers } = require('../services/pushService');
const { normalizePreferredLang } = require('./preferredLanguage');

const MS_DAY = 86400000;
const MS_HOUR = 3600000;

/** Built-in templates per locale (overridden by rule.message_de / message_en). */
const BUILTIN_MESSAGES = {
    A1_willkommen: {
        de: 'Willkommen bei Elaya, {{vorname}}! Schön, dass du dabei bist. Starte jetzt deinen ersten Case.',
        en: 'Welcome to Elaya, {{vorname}}! Great to have you. Start your first case now.',
    },
    A2_kein_case: {
        de: 'Hallo {{vorname}}, du hast noch keinen Case angelegt. Starte jetzt dein Onboarding — es dauert nur wenige Minuten!',
        en: 'Hi {{vorname}}, you haven’t created a case yet. Start onboarding now — it only takes a few minutes!',
    },
    A3_kein_termin: {
        de: 'Super, deine Anamnese ist ausgefüllt! Buch jetzt deinen Termin, damit wir den besten Plan für dich erstellen können.',
        en: 'Great — your anamnesis is done! Book your appointment now so we can build the best plan for you.',
    },
    B1_termin_1tag: {
        de: 'Erinnerung: Dein Termin ist morgen. Bitte komm ausgeruht und ohne frische Sonneneinwirkung.',
        en: 'Reminder: your appointment is tomorrow. Please arrive rested and without recent sun exposure.',
    },
    B2_termin_2h: {
        de: 'Dein Termin ist in ca. 2 Stunden! Vergiss nicht, pünktlich zu sein.',
        en: 'Your appointment is in about 2 hours! Don’t forget to arrive on time.',
    },
    B3_presession: {
        de: 'Pre-Session Check: Kein UV-Kontakt in den letzten 21 Tagen? Keine neuen Medikamente? Falls ja, meld dich bitte vor dem Termin.',
        en: 'Pre-session check: No UV exposure in the last 21 days? No new medication? If yes, please contact us before your appointment.',
    },
    C1_nachsorge_tag1: {
        de: 'Wie geht es dir nach der gestrigen Behandlung? Halte die Stelle sauber und pflege sie wie empfohlen. Nicht kratzen!',
        en: 'How are you feeling after yesterday’s treatment? Keep the area clean and care for it as recommended. Don’t scratch!',
    },
    C2_nachsorge_tag3: {
        de: 'Tag 3 nach der Behandlung — weiter pflegen und Sonne vermeiden. Leichte Rötung ist normal.',
        en: 'Day 3 after treatment — keep caring for the area and avoid sun. Mild redness is normal.',
    },
    C3_nachsorge_tag7: {
        de: 'Eine Woche geschafft! Die erste Heilungsphase ist vorbei. Feuchtigkeitspflege + LSF 50+ draussen.',
        en: 'One week done! The first healing phase is over. Moisturize and use SPF 50+ outdoors.',
    },
    C4_heilung_ok: {
        de: 'Die Heilungsphase ist abgeschlossen! Bereit für die nächste Sitzung? Schau in der App nach Terminen.',
        en: 'Healing phase complete! Ready for the next session? Check the app for appointments.',
    },
    D1_naechste_bereit: {
        de: 'Gute Neuigkeit! Die Wartezeit nach deiner letzten Sitzung ist abgelaufen. Du kannst die nächste Sitzung buchen.',
        en: 'Good news! The wait after your last session is over. You can book the next session.',
    },
    D2_naechste_erinnerung: {
        de: 'Noch kein Termin gebucht? Dein Case wartet auf die nächste Sitzung. Jetzt buchen und Fortschritt sichern!',
        en: 'Still no appointment booked? Your case is waiting for the next session. Book now to keep your progress!',
    },
    E1_reaktivierung_60: {
        de: 'Wir vermissen dich, {{vorname}}! Du warst schon eine Weile nicht aktiv. Buch einen Check-in!',
        en: 'We miss you, {{vorname}}! It’s been a while. Book a check-in!',
    },
    E2_reaktivierung_90: {
        de: 'Hallo {{vorname}}, fast 3 Monate ohne Check-in! Regelmäßige Sitzungen bringen die besten Ergebnisse.',
        en: 'Hi {{vorname}}, almost 3 months without a check-in! Regular sessions bring the best results.',
    },
    F1_shop_tag2: {
        de: 'Passende Nachsorgeprodukte findest du im ElayShop — empfohlen für die ersten Tage nach der Behandlung.',
        en: 'Find matching aftercare products in ElayShop — recommended for the first days after treatment.',
    },
    F2_shop_tag5: {
        de: 'Fast durch die erste Woche! Schau im Shop nach Regenerations- und Pflegeprodukten.',
        en: 'Almost through the first week! Check the shop for recovery and care products.',
    },
    F3_shop_sonnenschutz: {
        de: 'Sonnenschutz ist Pflicht! Behandelte Stellen reagieren empfindlich auf UV — LSF 50+ im Shop.',
        en: 'Sun protection is essential! Treated areas are UV-sensitive — SPF 50+ in the shop.',
    },
};

const TRIGGER_TYPES = [
    'on_first_check',
    'no_case_after_days',
    'anamnesis_no_appointment',
    'appointment_window_hours',
    'days_after_session',
    'ready_next_no_booking',
    'inactive_days',
    'seasonal_months',
];

const BUILTIN_TRIGGERS = {
    A1_willkommen: { type: 'on_first_check', cooldown_tage: 9999 },
    A2_kein_case: { type: 'no_case_after_days', cooldown_tage: 7 },
    A3_kein_termin: { type: 'anamnesis_no_appointment', cooldown_tage: 5 },
    B1_termin_1tag: {
        type: 'appointment_window_hours',
        hours_min: 22,
        hours_max: 26,
        cooldown_tage: 2,
    },
    B2_termin_2h: {
        type: 'appointment_window_hours',
        hours_min: 1,
        hours_max: 3,
        cooldown_tage: 1,
    },
    B3_presession: {
        type: 'appointment_window_hours',
        hours_min: 26,
        hours_max: 50,
        cooldown_tage: 2,
    },
    C1_nachsorge_tag1: {
        type: 'days_after_session',
        min_days: 1,
        max_days: 2,
        cooldown_tage: 90,
    },
    C2_nachsorge_tag3: {
        type: 'days_after_session',
        min_days: 3,
        max_days: 4,
        cooldown_tage: 90,
    },
    C3_nachsorge_tag7: {
        type: 'days_after_session',
        min_days: 7,
        max_days: 9,
        cooldown_tage: 90,
    },
    C4_heilung_ok: {
        type: 'days_after_session',
        min_days: 42,
        max_days: 50,
        cooldown_tage: 90,
    },
    D1_naechste_bereit: {
        type: 'ready_next_no_booking',
        lock_days: 49,
        extra_days: 0,
        cooldown_tage: 14,
    },
    D2_naechste_erinnerung: {
        type: 'ready_next_no_booking',
        lock_days: 49,
        extra_days_from_tage_wert: true,
        cooldown_tage: 7,
    },
    E1_reaktivierung_60: { type: 'inactive_days', days: 60, cooldown_tage: 30 },
    E2_reaktivierung_90: { type: 'inactive_days', days: 90, cooldown_tage: 30 },
    F1_shop_tag2: {
        type: 'days_after_session',
        min_days: 2,
        max_days: 2,
        cooldown_tage: 90,
    },
    F2_shop_tag5: {
        type: 'days_after_session',
        min_days: 5,
        max_days: 5,
        cooldown_tage: 90,
    },
    F3_shop_sonnenschutz: {
        type: 'seasonal_months',
        from_month: 4,
        to_month: 9,
        cooldown_tage: 30,
    },
};

const daysBetween = (from, to = new Date()) => {
    const a = new Date(from);
    const b = new Date(to);
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);
    return Math.floor((b - a) / MS_DAY);
};

const flatRules = (store) => {
    const out = [];
    for (const kat of store.kategorien || []) {
        for (const r of kat.regeln || []) out.push(r);
    }
    return out;
};

const resolveTrigger = (rule) => {
    const builtin = BUILTIN_TRIGGERS[rule.id];
    const custom =
        rule.trigger && typeof rule.trigger === 'object' ? rule.trigger : null;
    if (custom?.type && TRIGGER_TYPES.includes(custom.type)) {
        return { ...builtin, ...custom, type: custom.type };
    }
    if (builtin) return { ...builtin };
    // New Admin rule without trigger — cannot auto-fire
    return null;
};

const fillTemplate = (tpl, vars = {}) =>
    String(tpl || '').replace(/\{\{(\w+)\}\}/g, (_, k) =>
        vars[k] != null ? String(vars[k]) : ''
    );

const pickLocalized = (lang, deVal, enVal) =>
    lang === 'en' ? enVal || deVal || '' : deVal || enVal || '';

const messageForRule = (rule, vars, lang = 'de') => {
    const custom = pickLocalized(lang, rule.message_de, rule.message_en);
    if (custom && String(custom).trim()) {
        return fillTemplate(custom, vars);
    }
    const builtin = BUILTIN_MESSAGES[rule.id];
    if (builtin) {
        const tpl =
            typeof builtin === 'string'
                ? builtin
                : pickLocalized(lang, builtin.de, builtin.en);
        return fillTemplate(tpl, vars);
    }
    return fillTemplate(
        pickLocalized(
            lang,
            rule.beschreibung_de || rule.label_de,
            rule.beschreibung_en || rule.label_en
        ),
        vars
    );
};

const titleForRule = (rule, lang = 'de') =>
    pickLocalized(lang, rule.label_de, rule.label_en) || 'Elaya';

const logKey = (ruleId, kontextId) =>
    kontextId ? `${ruleId}|${kontextId}` : ruleId;

const isOnCooldown = (log, ruleId, kontextId, now) => {
    const key = logKey(ruleId, kontextId);
    return (log || []).some((e) => {
        const eid = logKey(e.rule_id || e.typ, e.kontext_id || e.behandlung_id || e.termin_id);
        if (eid !== key && (e.rule_id || e.typ) !== ruleId) {
            // legacy: plain rule_id without kontext
            if (!kontextId && (e.rule_id === ruleId || e.typ === ruleId)) {
                const until = e.naechste_erlaubt_am
                    ? new Date(e.naechste_erlaubt_am).getTime()
                    : 0;
                if (until > now.getTime()) return true;
                // old one-shot without cooldown date = already sent forever for A1-style
                if (!e.naechste_erlaubt_am && !kontextId) return true;
            }
            return false;
        }
        if (eid !== key) return false;
        const until = e.naechste_erlaubt_am
            ? new Date(e.naechste_erlaubt_am).getTime()
            : Infinity;
        return until > now.getTime();
    });
};

/**
 * Evaluate + send due automation messages for one customer.
 * @param {object} [options]
 * @param {'de'|'en'} [options.lang] — override; else User.preferred_language
 */
async function checkAutomationsForCustomer(customerId, userId, options = {}) {
    const customer = await Customer.findById(customerId);
    if (!customer || !userId) {
        return { fired: [], skipped: 'no_customer' };
    }

    let lang = normalizePreferredLang(options.lang);
    if (!lang) {
        const user = await User.findById(userId).select('preferred_language').lean();
        lang = normalizePreferredLang(user?.preferred_language) || 'de';
    }

    const studioId = customer.aktuelle_firma_id;
    const [platform, studio] = await Promise.all([
        getPlatformConfig(),
        Studio.findById(studioId).select('automatisierungen_overrides firma').lean(),
    ]);
    const effective = mergeEffectiveAutomations(
        platform,
        studio?.automatisierungen_overrides || {}
    );
    const rules = flatRules(effective).filter((r) => r.aktiv !== false);
    if (!rules.length) {
        return { fired: [], rules_active: 0 };
    }

    if (!Array.isArray(customer.automatisierungen_log)) {
        customer.automatisierungen_log = [];
    }

    const now = new Date();
    const month = now.getMonth() + 1;
    const vorname = customer.vorname || '';
    const vars = { vorname, studio: studio?.firma || 'Elaya' };

    const [cases, appointments, sessions] = await Promise.all([
        Case.find({ customer: customerId }).select('_id').lean(),
        Appointment.find({
            customer: customerId,
            status: {
                $nin: [APPOINTMENT_STATUS.STORNIERT, APPOINTMENT_STATUS.CANCELLED],
            },
        })
            .select('_id date case status')
            .lean(),
        Session.find({
            customer: customerId,
            is_draft: { $ne: true },
            is_no_show: { $ne: true },
        })
            .select('_id case treatment_date session_number')
            .sort({ treatment_date: -1 })
            .lean(),
    ]);

    const caseIds = cases.map((c) => c._id);
    const anamList =
        caseIds.length > 0
            ? await Anamnesis.find({ case: { $in: caseIds } })
                  .select('case ampel_status createdAt updatedAt')
                  .lean()
            : [];
    const anamByCase = {};
    for (const a of anamList) {
        anamByCase[String(a.case)] = a;
    }

    const sessionsByCase = {};
    for (const s of sessions) {
        const cid = String(s.case);
        if (!sessionsByCase[cid]) sessionsByCase[cid] = [];
        sessionsByCase[cid].push(s);
    }

    const aptsByCase = {};
    for (const a of appointments) {
        const cid = a.case ? String(a.case) : '_';
        if (!aptsByCase[cid]) aptsByCase[cid] = [];
        aptsByCase[cid].push(a);
    }

    const latestSessionOverall = sessions[0] || null;
    const latestApt = appointments
        .filter((a) => a.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const lastContact =
        latestApt?.date ||
        latestSessionOverall?.treatment_date ||
        customer.createdAt;
    const inactiveDays = daysBetween(lastContact, now);

    const fired = [];
    const pendingLog = [];

    const fire = async (rule, body, { kontextId = null, cooldownTage = 14 } = {}) => {
        if (isOnCooldown(customer.automatisierungen_log, rule.id, kontextId, now)) {
            return;
        }
        // Also block if we already queued this key in this run
        const key = logKey(rule.id, kontextId);
        if (pendingLog.some((e) => logKey(e.rule_id, e.kontext_id) === key)) return;

        const title = titleForRule(rule, lang);
        const text = body || messageForRule(rule, vars, lang);
        try {
            await createForUsers({
                userIds: [userId],
                type: 'automation',
                title,
                body: text,
                studioId: studioId?.toString?.() || studioId,
            });
        } catch (err) {
            console.error('Automation inbox failed:', err.message);
            return;
        }
        try {
            await sendToUsers([userId], {
                title,
                body: text,
                data: { type: 'automation', rule_id: rule.id },
            });
        } catch (err) {
            console.error('Automation push failed:', err.message);
        }

        const entry = {
            rule_id: rule.id,
            kontext_id: kontextId || null,
            sent_at: now,
            naechste_erlaubt_am: new Date(now.getTime() + cooldownTage * MS_DAY),
        };
        pendingLog.push(entry);
        customer.automatisierungen_log.push(entry);
        fired.push(key);
    };

    for (const rule of rules) {
        const trigger = resolveTrigger(rule);
        if (!trigger?.type) continue;

        const tageWert =
            rule.tage_wert != null && rule.tage_wert !== ''
                ? Number(rule.tage_wert)
                : null;
        const cooldown = trigger.cooldown_tage ?? 14;

        switch (trigger.type) {
            case 'on_first_check': {
                await fire(rule, null, { cooldownTage: cooldown });
                break;
            }
            case 'no_case_after_days': {
                const days = tageWert ?? trigger.days ?? 3;
                if (
                    cases.length === 0 &&
                    daysBetween(customer.createdAt, now) >= days
                ) {
                    await fire(rule, null, { cooldownTage: cooldown });
                }
                break;
            }
            case 'anamnesis_no_appointment': {
                const days = tageWert ?? trigger.days ?? 2;
                for (const c of cases) {
                    const cid = String(c._id);
                    const anam = anamByCase[cid];
                    if (!anam?.ampel_status) continue;
                    const hasApt = (aptsByCase[cid] || []).length > 0;
                    if (hasApt) continue;
                    const aTs = anam.updatedAt || anam.createdAt;
                    if (daysBetween(aTs, now) >= days) {
                        await fire(rule, null, {
                            kontextId: cid,
                            cooldownTage: cooldown,
                        });
                    }
                }
                break;
            }
            case 'appointment_window_hours': {
                const hMin = Number(trigger.hours_min ?? 0);
                const hMax = Number(trigger.hours_max ?? 0);
                for (const apt of appointments) {
                    if (!apt.date) continue;
                    const diff = new Date(apt.date).getTime() - now.getTime();
                    if (diff > hMin * MS_HOUR && diff <= hMax * MS_HOUR) {
                        await fire(rule, null, {
                            kontextId: String(apt._id),
                            cooldownTage: cooldown,
                        });
                    }
                }
                break;
            }
            case 'days_after_session': {
                const minD = Number(trigger.min_days ?? 0);
                const maxD = Number(trigger.max_days ?? minD);
                for (const c of cases) {
                    const cid = String(c._id);
                    const sl = sessionsByCase[cid] || [];
                    if (!sl.length) continue;
                    const letzte = sl[0];
                    const tage = daysBetween(letzte.treatment_date, now);
                    if (tage >= minD && tage <= maxD) {
                        const uid = `${cid}|${String(letzte._id)}`;
                        await fire(rule, null, {
                            kontextId: uid,
                            cooldownTage: cooldown,
                        });
                    }
                }
                break;
            }
            case 'ready_next_no_booking': {
                const lock = Number(trigger.lock_days ?? 49);
                const extra = trigger.extra_days_from_tage_wert
                    ? tageWert ?? 7
                    : Number(trigger.extra_days ?? 0);
                const need = lock + extra;
                for (const c of cases) {
                    const cid = String(c._id);
                    const sl = sessionsByCase[cid] || [];
                    if (!sl.length) continue;
                    const letzte = sl[0];
                    const tage = daysBetween(letzte.treatment_date, now);
                    const hasApt = (aptsByCase[cid] || []).length > 0;
                    if (tage >= need && !hasApt) {
                        await fire(rule, null, {
                            kontextId: cid,
                            cooldownTage: cooldown,
                        });
                    }
                }
                break;
            }
            case 'inactive_days': {
                const need = Number(trigger.days ?? tageWert ?? 60);
                if (inactiveDays >= need) {
                    await fire(rule, null, { cooldownTage: cooldown });
                }
                break;
            }
            case 'seasonal_months': {
                const from = Number(trigger.from_month ?? 4);
                const to = Number(trigger.to_month ?? 9);
                if (month >= from && month <= to) {
                    await fire(rule, null, { cooldownTage: cooldown });
                }
                break;
            }
            default:
                break;
        }
    }

    if (fired.length) {
        customer.markModified('automatisierungen_log');
        await customer.save();
    }

    return { fired, rules_active: rules.length };
}

/**
 * Background batch — all customers (paginated). Used by scheduler.
 */
async function runAutomationsBatch({ limit = 150, skip = 0 } = {}) {
    const customers = await Customer.find({})
        .select('_id user')
        .sort({ _id: 1 })
        .skip(skip)
        .limit(Math.min(500, Math.max(1, limit)))
        .lean();

    let checked = 0;
    let firedTotal = 0;
    for (const c of customers) {
        if (!c.user) continue;
        try {
            const result = await checkAutomationsForCustomer(c._id, c.user);
            checked += 1;
            firedTotal += result.fired?.length || 0;
        } catch (err) {
            console.error(`Automations batch customer ${c._id}:`, err.message);
        }
    }
    return { checked, fired: firedTotal, batch_size: customers.length };
}

module.exports = {
    checkAutomationsForCustomer,
    runAutomationsBatch,
    TRIGGER_TYPES,
    BUILTIN_TRIGGERS,
    BUILTIN_MESSAGES,
    resolveTrigger,
};

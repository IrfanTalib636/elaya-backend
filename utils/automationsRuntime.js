const Customer = require('../models/customerModel');
const Appointment = require('../models/appointmentModel');
const Case = require('../models/caseModel');
const Studio = require('../models/studioModel');
const { APPOINTMENT_STATUS } = require('../config/constants');
const {
    getPlatformConfig,
    mergeEffectiveAutomations,
} = require('./configService');
const { createForUsers } = require('../services/notificationService');

const daysBetween = (from, to = new Date()) => {
    const a = new Date(from);
    const b = new Date(to);
    a.setHours(0, 0, 0, 0);
    b.setHours(0, 0, 0, 0);
    return Math.round((b - a) / (24 * 3600 * 1000));
};

const flatRules = (store) => {
    const out = [];
    for (const kat of store.kategorien || []) {
        for (const r of kat.regeln || []) out.push(r);
    }
    return out;
};

/**
 * Evaluate studio-effective automation rules for a customer and enqueue
 * in-app notifications for newly due rules (prototype pruefeAutomatisierungen).
 * Dedupes via customer.automatisierungen_log.
 */
async function checkAutomationsForCustomer(customerId, userId) {
    const customer = await Customer.findById(customerId);
    if (!customer || !userId) {
        return { fired: [], skipped: 'no_customer' };
    }

    const studioId = customer.aktuelle_firma_id;
    const [platform, studio] = await Promise.all([
        getPlatformConfig(),
        Studio.findById(studioId).select('automatisierungen_overrides').lean(),
    ]);
    const effective = mergeEffectiveAutomations(
        platform,
        studio?.automatisierungen_overrides || {}
    );
    const rules = flatRules(effective).filter((r) => r.aktiv !== false);

    if (!Array.isArray(customer.automatisierungen_log)) {
        customer.automatisierungen_log = [];
    }
    const already = new Set(
        customer.automatisierungen_log.map((e) => e.rule_id || e.ruleId).filter(Boolean)
    );

    const [caseCount, nextApt] = await Promise.all([
        Case.countDocuments({ customer: customerId }),
        Appointment.findOne({
            customer: customerId,
            date: { $gte: new Date() },
            status: {
                $nin: [APPOINTMENT_STATUS.STORNIERT, APPOINTMENT_STATUS.CANCELLED],
            },
        })
            .sort({ date: 1 })
            .select('date status')
            .lean(),
    ]);

    const fired = [];
    const now = new Date();

    const maybeFire = async (rule, title, body) => {
        if (!rule || already.has(rule.id)) return;
        await createForUsers({
            userIds: [userId],
            type: 'automation',
            title,
            body,
            studioId: studioId?.toString?.() || studioId,
        });
        customer.automatisierungen_log.push({
            rule_id: rule.id,
            sent_at: now,
        });
        already.add(rule.id);
        fired.push(rule.id);
    };

    const byId = Object.fromEntries(rules.map((r) => [r.id, r]));

    // A1 — welcome once
    if (byId.A1_willkommen) {
        await maybeFire(
            byId.A1_willkommen,
            byId.A1_willkommen.label_de || 'Willkommen',
            byId.A1_willkommen.beschreibung_de ||
                'Willkommen bei Elaya — wir freuen uns auf dich.'
        );
    }

    // A2 — no case after X days
    if (byId.A2_kein_case && caseCount === 0) {
        const days = byId.A2_kein_case.tage_wert ?? 3;
        if (daysBetween(customer.registriert_am || customer.createdAt, now) >= days) {
            await maybeFire(
                byId.A2_kein_case,
                byId.A2_kein_case.label_de,
                byId.A2_kein_case.beschreibung_de
            );
        }
    }

    // B1 — appointment reminder ~24h before
    if (byId.B1_termin_1tag && nextApt?.date) {
        const hoursUntil = (new Date(nextApt.date) - now) / (3600 * 1000);
        if (hoursUntil > 0 && hoursUntil <= 28) {
            const logKey = `B1_termin_1tag:${String(nextApt._id)}`;
            if (!already.has(logKey)) {
                await createForUsers({
                    userIds: [userId],
                    type: 'automation',
                    title: byId.B1_termin_1tag.label_de || 'Termin-Erinnerung',
                    body:
                        byId.B1_termin_1tag.beschreibung_de ||
                        'Dein Termin steht bald an.',
                    studioId: studioId?.toString?.() || studioId,
                });
                customer.automatisierungen_log.push({
                    rule_id: logKey,
                    sent_at: now,
                });
                fired.push(logKey);
            }
        }
    }

    if (fired.length) {
        customer.markModified('automatisierungen_log');
        await customer.save();
    }

    return { fired, rules_active: rules.length };
}

module.exports = {
    checkAutomationsForCustomer,
    mergeEffectiveAutomations,
};

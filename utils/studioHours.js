const { WEEKDAY_KEYS, mergeOeffnungszeiten } = require('../config/studioDefaults');

const JS_DAY_TO_KEY = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];

const toDateKey = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const parseDateKey = (iso) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
};

const normalizeAusnahmen = (list = []) => {
    const byDate = new Map();
    for (const item of list) {
        const datum = toDateKey(item.datum || item);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) continue;
        byDate.set(datum, {
            datum,
            offen: item.offen !== false,
            von: item.von || '10:00',
            bis: item.bis || '19:00',
            notiz: item.notiz || '',
        });
    }
    return [...byDate.values()].sort((a, b) => a.datum.localeCompare(b.datum));
};

const weekdayKeyForDate = (date) => {
    const d = date instanceof Date ? date : parseDateKey(date);
    if (!d || Number.isNaN(d.getTime())) return WEEKDAY_KEYS[0];
    return JS_DAY_TO_KEY[d.getDay()];
};

const resolveHoursForDate = (oeffnungszeiten, ausnahmen, date) => {
    const key = typeof date === 'string' ? date.slice(0, 10) : toDateKey(date);
    const exception = (ausnahmen || []).find((item) => item.datum === key);
    if (exception) {
        return {
            offen: exception.offen !== false,
            von: exception.von || '10:00',
            bis: exception.bis || '19:00',
            notiz: exception.notiz || '',
            source: 'exception',
        };
    }

    const weekly = mergeOeffnungszeiten(oeffnungszeiten);
    const weekday = weekly[weekdayKeyForDate(key)] || { offen: true, von: '10:00', bis: '19:00' };
    return {
        offen: weekday.offen !== false,
        von: weekday.von || '10:00',
        bis: weekday.bis || '19:00',
        notiz: '',
        source: 'weekly',
    };
};

const collectClosedDates = (studio, from, to) => {
    if (!from || !to) return [];
    const start = parseDateKey(toDateKey(from));
    const end = parseDateKey(toDateKey(to));
    if (!start || !end || start > end) return [];

    const ausnahmen = normalizeAusnahmen(studio.oeffnungs_ausnahmen);
    const closed = [];
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
        const hours = resolveHoursForDate(studio.oeffnungszeiten, ausnahmen, cursor);
        if (!hours.offen) closed.push(toDateKey(cursor));
    }
    return closed;
};

module.exports = {
    toDateKey,
    normalizeAusnahmen,
    resolveHoursForDate,
    collectClosedDates,
    weekdayKeyForDate,
};

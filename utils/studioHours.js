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

const timeToMinutes = (value) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
};

const minutesToTime = (total) => {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/**
 * Build bookable start times between von (inclusive) and bis (exclusive).
 * Default interval 60 minutes (matches mobile booking UX).
 */
const buildTimeSlots = (von, bis, intervalMinutes = 60) => {
    const start = timeToMinutes(von);
    const end = timeToMinutes(bis);
    const step = Math.max(15, Number(intervalMinutes) || 60);
    if (start == null || end == null || end <= start) return [];

    const slots = [];
    for (let cursor = start; cursor < end; cursor += step) {
        slots.push(minutesToTime(cursor));
    }
    return slots;
};

const buildStudioScheduleSnapshot = (studio) => {
    if (!studio) return null;
    const weekly = mergeOeffnungszeiten(studio.oeffnungszeiten);
    const exceptions = normalizeAusnahmen(studio.oeffnungs_ausnahmen);
    const slotInterval = 60;
    return {
        weekly,
        exceptions,
        pufferzeit_minuten: studio.pufferzeit_minuten ?? 10,
        slot_interval_minuten: slotInterval,
    };
};

const slotsForStudioDate = (studio, isoDate, intervalMinutes = 60) => {
    const ausnahmen = normalizeAusnahmen(studio?.oeffnungs_ausnahmen);
    const hours = resolveHoursForDate(studio?.oeffnungszeiten, ausnahmen, isoDate);
    if (!hours.offen) return { offen: false, von: hours.von, bis: hours.bis, time_slots: [] };
    return {
        offen: true,
        von: hours.von,
        bis: hours.bis,
        time_slots: buildTimeSlots(hours.von, hours.bis, intervalMinutes),
    };
};

module.exports = {
    toDateKey,
    normalizeAusnahmen,
    resolveHoursForDate,
    collectClosedDates,
    weekdayKeyForDate,
    buildTimeSlots,
    buildStudioScheduleSnapshot,
    slotsForStudioDate,
};

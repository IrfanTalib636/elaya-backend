const {
    WEEKDAY_KEYS,
    DEFAULT_DAY_HOURS,
    DEFAULT_SLOT_INTERVAL_MINUTEN,
    DEFAULT_PUFFERZEIT_MINUTEN,
    MIN_SLOT_INTERVAL_MINUTEN,
    mergeOeffnungszeiten,
} = require('../config/studioDefaults');

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
            von: item.von || DEFAULT_DAY_HOURS.von,
            bis: item.bis || DEFAULT_DAY_HOURS.bis,
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
            von: exception.von || DEFAULT_DAY_HOURS.von,
            bis: exception.bis || DEFAULT_DAY_HOURS.bis,
            notiz: exception.notiz || '',
            source: 'exception',
        };
    }

    const weekly = mergeOeffnungszeiten(oeffnungszeiten);
    const weekday = weekly[weekdayKeyForDate(key)] || { ...DEFAULT_DAY_HOURS };
    return {
        offen: weekday.offen !== false,
        von: weekday.von || DEFAULT_DAY_HOURS.von,
        bis: weekday.bis || DEFAULT_DAY_HOURS.bis,
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
 * The interval comes from the studio's schedule.
 */
const buildTimeSlots = (von, bis, intervalMinutes = DEFAULT_SLOT_INTERVAL_MINUTEN) => {
    const start = timeToMinutes(von);
    const end = timeToMinutes(bis);
    const step = Math.max(
        MIN_SLOT_INTERVAL_MINUTEN,
        Number(intervalMinutes) || DEFAULT_SLOT_INTERVAL_MINUTEN
    );
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
    const slotInterval = Number(studio.slot_interval_minuten) || DEFAULT_SLOT_INTERVAL_MINUTEN;
    return {
        weekly,
        exceptions,
        pufferzeit_minuten: studio.pufferzeit_minuten ?? DEFAULT_PUFFERZEIT_MINUTEN,
        slot_interval_minuten: slotInterval,
    };
};

const standortId = (standort) => String(standort?._id ?? standort?.id ?? '');

const findStandort = (studio, id) => {
    if (!id) return null;
    return (studio?.standorte || []).find((s) => standortId(s) === String(id)) || null;
};

const activeStandorte = (studio) =>
    (studio?.standorte || []).filter((s) => s.aktiv !== false);

/**
 * Studio-shaped schedule view for a single location. Any field the location does
 * not override falls back to the studio-wide value, so studios without
 * locations (or with locations that share one schedule) behave exactly as before.
 */
const resolveStandortSchedule = (studio, id) => {
    const standort = findStandort(studio, id);
    if (!standort) return studio;

    const weekly =
        standort.oeffnungszeiten && Object.keys(standort.oeffnungszeiten).length
            ? standort.oeffnungszeiten
            : studio?.oeffnungszeiten;
    const ausnahmen = standort.oeffnungs_ausnahmen?.length
        ? standort.oeffnungs_ausnahmen
        : studio?.oeffnungs_ausnahmen;

    return {
        oeffnungszeiten: weekly,
        oeffnungs_ausnahmen: ausnahmen,
        pufferzeit_minuten: standort.pufferzeit_minuten ?? studio?.pufferzeit_minuten,
        slot_interval_minuten:
            standort.slot_interval_minuten ?? studio?.slot_interval_minuten,
    };
};

/** Rooms with no `standort_id` are shared across all locations. */
const roomsForStandort = (studio, id) =>
    (studio?.behandlungsraeume || []).filter(
        (room) =>
            room.aktiv !== false &&
            (!id || !room.standort_id || String(room.standort_id) === String(id))
    );

/** Staff with no `standort_id` work at all locations. */
const staffForStandort = (studio, id) =>
    (studio?.mitarbeiter || []).filter(
        (member) =>
            member.aktiv !== false &&
            (!id || !member.standort_id || String(member.standort_id) === String(id))
    );

const slotOverlapsWindow = (slotStart, slotInterval, windowStart, windowEnd) => {
    const slotEnd = slotStart + slotInterval;
    return slotStart < windowEnd && slotEnd > windowStart;
};

const collectOccupiedTimes = (
    appointments,
    intervalMinutes = DEFAULT_SLOT_INTERVAL_MINUTEN,
    bufferMinutes = 0
) => {
    const interval = Math.max(
        MIN_SLOT_INTERVAL_MINUTEN,
        Number(intervalMinutes) || DEFAULT_SLOT_INTERVAL_MINUTEN
    );
    const buffer = Math.max(0, Number(bufferMinutes) || 0);
    const byDate = {};
    for (const appointment of appointments || []) {
        const dateKey = toDateKey(appointment.date);
        const start = timeToMinutes(appointment.time);
        if (!dateKey || start == null) continue;
        const duration = Number(appointment.dauer_minuten) > 0 ? Number(appointment.dauer_minuten) : interval;
        const windowEnd = start + duration + buffer;
        if (!byDate[dateKey]) byDate[dateKey] = new Set();
        for (let cursor = start; cursor < windowEnd; cursor += interval) {
            byDate[dateKey].add(minutesToTime(cursor));
        }
    }
    return Object.fromEntries(
        Object.entries(byDate).map(([key, set]) => [key, [...set].sort()])
    );
};

const isSlotOccupied = (occupiedTimes, isoDate, time) => {
    const list = occupiedTimes?.[String(isoDate).slice(0, 10)] || [];
    return list.includes(String(time || '').slice(0, 5));
};

const slotsForStudioDate = (
    studio,
    isoDate,
    intervalMinutes = DEFAULT_SLOT_INTERVAL_MINUTEN
) => {
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
    findStandort,
    activeStandorte,
    resolveStandortSchedule,
    roomsForStandort,
    staffForStandort,
    resolveHoursForDate,
    collectClosedDates,
    weekdayKeyForDate,
    buildTimeSlots,
    buildStudioScheduleSnapshot,
    slotsForStudioDate,
    collectOccupiedTimes,
    isSlotOccupied,
    slotOverlapsWindow,
};

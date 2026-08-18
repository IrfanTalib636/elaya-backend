const ActivityEvent = require('../models/activityEventModel');
const { isCustomer, isStudio, isAdmin } = require('./accessHelpers');
const {
    ACTIVITY_CATEGORY,
    ACTIVITY_ACTOR_ROLE,
    TAG_FOR_CATEGORY,
} = require('../config/activityConfig');

const MONTHS_DE = [
    'Januar',
    'Februar',
    'März',
    'April',
    'Mai',
    'Juni',
    'Juli',
    'August',
    'September',
    'Oktober',
    'November',
    'Dezember',
];

const oid = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value._id) return value._id.toString();
    return value.toString();
};

const caseLabel = (caseDoc) => {
    if (!caseDoc) return '';
    return caseDoc.bodyLabel || caseDoc.tc_title || caseDoc.caseId || '';
};

const formatApptStamp = (dateValue, time = '') => {
    const date = dateValue ? new Date(dateValue) : null;
    if (!date || Number.isNaN(date.getTime())) {
        return time || '';
    }
    const day = date.getDate();
    const stamp = `${day}. ${MONTHS_DE[date.getMonth()]} ${date.getFullYear()}`;
    return time ? `${stamp} ${time} Uhr` : stamp;
};

const actorFromUser = (user) => {
    if (!user) {
        return {
            actor_role: ACTIVITY_ACTOR_ROLE.SYSTEM,
            actor_name: 'System',
            actor_id: null,
        };
    }
    let actor_role = ACTIVITY_ACTOR_ROLE.SYSTEM;
    if (isCustomer(user.role)) actor_role = ACTIVITY_ACTOR_ROLE.CUSTOMER;
    else if (isStudio(user.role)) actor_role = ACTIVITY_ACTOR_ROLE.STUDIO;
    else if (isAdmin(user.role)) actor_role = ACTIVITY_ACTOR_ROLE.ADMIN;

    return {
        actor_role,
        actor_name: user.email || user.name || '',
        actor_id: user._id || null,
    };
};

/**
 * Append-only activity event. Never throws — logging must not break the primary action.
 * Duplicate source_key is ignored (idempotent).
 */
const recordActivity = async (fields = {}) => {
    try {
        if (!fields.studio || !fields.source_key || !fields.title || !fields.type) {
            return null;
        }
        const category = fields.category || ACTIVITY_CATEGORY.OTHER;
        const doc = {
            studio: fields.studio,
            customer: fields.customer || null,
            case: fields.case || null,
            appointment: fields.appointment || null,
            session: fields.session || null,
            category,
            type: fields.type,
            tag: fields.tag || TAG_FOR_CATEGORY[category] || 'SONSTIGES',
            title: fields.title,
            details: fields.details || '',
            actor_role: fields.actor_role || ACTIVITY_ACTOR_ROLE.SYSTEM,
            actor_name: fields.actor_name || '',
            actor_id: fields.actor_id || null,
            payload: fields.payload || {},
            source_key: fields.source_key,
            ts: fields.ts || new Date(),
        };

        await ActivityEvent.updateOne(
            { source_key: doc.source_key },
            { $setOnInsert: doc },
            { upsert: true }
        );
        return true;
    } catch (err) {
        if (err?.code !== 11000) {
            console.error('[activity]', err.message);
        }
        return null;
    }
};

const recordActivityFromUser = (user, fields) =>
    recordActivity({
        ...fields,
        ...actorFromUser(user),
    });

module.exports = {
    oid,
    caseLabel,
    formatApptStamp,
    actorFromUser,
    recordActivity,
    recordActivityFromUser,
};

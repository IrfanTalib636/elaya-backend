const {
    PlatformAuditLog,
    PLATFORM_AUDIT_ACTION,
} = require('../models/platformAuditLogModel');

const pickChanged = (before = {}, after = {}, keys = []) => {
    const changed = {};
    for (const key of keys) {
        const b = before?.[key];
        const a = after?.[key];
        if (JSON.stringify(b) !== JSON.stringify(a)) {
            changed[key] = { before: b ?? null, after: a ?? null };
        }
    }
    return changed;
};

/**
 * Fire-and-forget platform audit row. Never throws to callers.
 */
const logPlatformAudit = async ({
    actor,
    action,
    targetType = 'other',
    targetId = null,
    studioId = null,
    reason = '',
    before = null,
    after = null,
    meta = null,
    ip = '',
} = {}) => {
    try {
        if (!actor?._id && !actor?.id) return null;
        await PlatformAuditLog.create({
            actor: actor._id || actor.id,
            actor_role: actor.role || '',
            actor_email: actor.email || '',
            action,
            target_type: targetType,
            target_id: targetId ? String(targetId) : null,
            studio: studioId || null,
            reason: String(reason || '').trim().slice(0, 2000),
            before,
            after,
            meta,
            ip: ip || '',
        });
    } catch (err) {
        console.error('Platform audit log failed:', err.message);
    }
    return null;
};

module.exports = {
    logPlatformAudit,
    pickChanged,
    PLATFORM_AUDIT_ACTION,
};

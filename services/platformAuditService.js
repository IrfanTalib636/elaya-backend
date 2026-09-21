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

/**
 * Read-only list for admin Audit-Log UI (prototype parity).
 * Append-only store — this never updates or deletes rows.
 */
const listPlatformAuditLogs = async ({
    action = '',
    date = '',
    page = 1,
    limit = 100,
} = {}) => {
    const filter = {};
    const actionTrim = String(action || '').trim();
    if (actionTrim) filter.action = actionTrim;

    const dateTrim = String(date || '').trim();
    if (dateTrim && /^\d{4}-\d{2}-\d{2}$/.test(dateTrim)) {
        const [y, m, d] = dateTrim.split('-').map(Number);
        const from = new Date(y, m - 1, d, 0, 0, 0, 0);
        const to = new Date(y, m - 1, d, 23, 59, 59, 999);
        filter.createdAt = { $gte: from, $lte: to };
    }

    const pageNum = Math.max(1, Number(page) || 1);
    const lim = Math.min(200, Math.max(1, Number(limit) || 100));
    const skip = (pageNum - 1) * lim;

    const [total, rows, actionTypes] = await Promise.all([
        PlatformAuditLog.countDocuments(filter),
        PlatformAuditLog.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(lim)
            .populate('studio', 'firma studio_code')
            .populate('actor', 'name email role')
            .lean(),
        PlatformAuditLog.distinct('action'),
    ]);

    const items = rows.map((e) => {
        const studioName =
            e.studio?.firma ||
            e.meta?.firma ||
            e.meta?.studio_name ||
            e.meta?.studio ||
            '';
        const studioCode = e.studio?.studio_code || e.meta?.studio_code || '';
        const target =
            e.meta?.firma ||
            e.meta?.target_label ||
            e.meta?.name ||
            e.target_id ||
            e.target_type ||
            '';
        return {
            id: String(e._id),
            timestamp: e.createdAt,
            action: e.action,
            target: target || '—',
            studio: studioName || '—',
            studio_code: studioCode || '',
            reason: e.reason || '',
            actor_email: e.actor_email || e.actor?.email || '',
            actor_role: e.actor_role || e.actor?.role || '',
            target_type: e.target_type,
            target_id: e.target_id,
            before: e.before ?? null,
            after: e.after ?? null,
            meta: e.meta ?? null,
            ip: e.ip || '',
        };
    });

    return {
        items,
        total,
        page: pageNum,
        limit: lim,
        action_types: (actionTypes || []).filter(Boolean).sort(),
        read_only: true,
    };
};

module.exports = {
    logPlatformAudit,
    pickChanged,
    listPlatformAuditLogs,
    PLATFORM_AUDIT_ACTION,
};

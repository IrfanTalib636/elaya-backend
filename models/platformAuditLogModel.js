const mongoose = require('mongoose');

/**
 * Append-only audit trail for platform / admin interventions
 * (config changes, sensitive support actions).
 */
const PLATFORM_AUDIT_ACTION = {
    PLATFORM_CONFIG_PATCH: 'platform_config_patch',
    STUDIO_CONFIG_PATCH: 'studio_config_patch',
    SPERRFRISTEN_PATCH: 'sperrfristen_patch',
    STUDIO_WORKSPACE_OPEN: 'studio_workspace_open',
    CONFIG_DRAFT_SAVE: 'config_draft_save',
    CONFIG_DRAFT_DISCARD: 'config_draft_discard',
    CONFIG_PUBLISH: 'config_publish',
    CONFIG_ROLLBACK: 'config_rollback',
    LASER_CATALOG_CREATE: 'laser_catalog_create',
    LASER_CATALOG_UPDATE: 'laser_catalog_update',
    LASER_REQUEST_RESOLVE: 'laser_request_resolve',
    AI_CONFIG_UPDATE: 'ai_config_update',
    ADMIN_INVITE: 'admin_invite',
    ADMIN_UPDATE: 'admin_update',
};

const platformAuditLogSchema = new mongoose.Schema(
    {
        actor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        actor_role: { type: String, default: '', index: true },
        actor_email: { type: String, default: '' },
        action: {
            type: String,
            enum: Object.values(PLATFORM_AUDIT_ACTION),
            required: true,
            index: true,
        },
        target_type: {
            type: String,
            enum: ['platform', 'studio', 'customer', 'case', 'user', 'laser', 'other'],
            default: 'other',
            index: true,
        },
        target_id: {
            type: String,
            default: null,
            index: true,
        },
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            default: null,
            index: true,
        },
        reason: { type: String, default: '', maxlength: 2000 },
        before: { type: mongoose.Schema.Types.Mixed, default: null },
        after: { type: mongoose.Schema.Types.Mixed, default: null },
        meta: { type: mongoose.Schema.Types.Mixed, default: null },
        ip: { type: String, default: '' },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

platformAuditLogSchema.index({ createdAt: -1 });

const PlatformAuditLog = mongoose.model('PlatformAuditLog', platformAuditLogSchema);

module.exports = {
    PlatformAuditLog,
    PLATFORM_AUDIT_ACTION,
};

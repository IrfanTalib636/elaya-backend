const mongoose = require('mongoose');
const { FILE_AUDIT_ACTION } = require('../config/storageConfig');

const fileAccessAuditSchema = new mongoose.Schema(
    {
        file: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FileAsset',
            required: true,
            index: true,
        },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        action: {
            type: String,
            enum: Object.values(FILE_AUDIT_ACTION),
            required: true,
        },
        ip: { type: String, default: '' },
        meta: { type: mongoose.Schema.Types.Mixed },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('FileAccessAudit', fileAccessAuditSchema);

const mongoose = require('mongoose');

const VERSIONED_CONFIG_DOMAINS = [
    'sperrfristen',
    'default_pricing',
    'session_prediction',
];

/**
 * Immutable published snapshot of one platform config domain.
 * Rollback creates a new published row (never mutates older rows).
 */
const platformConfigVersionSchema = new mongoose.Schema(
    {
        domain: {
            type: String,
            enum: VERSIONED_CONFIG_DOMAINS,
            required: true,
            index: true,
        },
        version: {
            type: Number,
            required: true,
            min: 1,
        },
        snapshot: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        note: {
            type: String,
            default: '',
            maxlength: 2000,
        },
        published_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        published_at: {
            type: Date,
            default: Date.now,
            index: true,
        },
        /** When this row was created by rolling back to an older version. */
        rolled_back_from: {
            type: Number,
            default: null,
        },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
    }
);

platformConfigVersionSchema.index({ domain: 1, version: -1 }, { unique: true });

const PlatformConfigVersion = mongoose.model(
    'PlatformConfigVersion',
    platformConfigVersionSchema
);

module.exports = {
    PlatformConfigVersion,
    VERSIONED_CONFIG_DOMAINS,
};

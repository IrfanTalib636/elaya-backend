const mongoose = require('mongoose');
const crypto = require('crypto');

const refreshTokenSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        token_hash: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        expires_at: {
            type: Date,
            required: true,
        },
        revoked_at: {
            type: Date,
            default: null,
        },
        replaced_by: {
            type: String,
            default: null,
        },
        user_agent: {
            type: String,
            default: '',
        },
        ip_address: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

refreshTokenSchema.statics.hashToken = function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
};

refreshTokenSchema.methods.isValid = function isValid() {
    return !this.revoked_at && this.expires_at > new Date();
};

refreshTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = RefreshToken;

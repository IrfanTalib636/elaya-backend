const mongoose = require('mongoose');
const crypto = require('crypto');

const passwordResetTokenSchema = new mongoose.Schema(
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
        used_at: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

passwordResetTokenSchema.statics.hashToken = function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
};

passwordResetTokenSchema.methods.isValid = function isValid() {
    return !this.used_at && this.expires_at > new Date();
};

passwordResetTokenSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });

const PasswordResetToken = mongoose.model('PasswordResetToken', passwordResetTokenSchema);

module.exports = PasswordResetToken;

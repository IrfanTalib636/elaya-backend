const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { USER_ROLES, USER_STATUS } = require('../config/constants');

const userSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        password: {
            type: String,
            required: [true, 'Password is required'],
            minlength: 8,
            select: false,
        },
        role: {
            type: String,
            enum: Object.values(USER_ROLES),
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(USER_STATUS),
            default: USER_STATUS.AKTIV,
            index: true,
        },
        studio_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            default: null,
            index: true,
        },
        customer_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            default: null,
            index: true,
        },
        last_login: {
            type: Date,
            default: null,
        },
        // Expo push tokens of the user's signed-in devices (customer mobile app).
        push_tokens: [
            {
                _id: false,
                token: { type: String, required: true },
                platform: { type: String, enum: ['ios', 'android'], default: null },
                updated_at: { type: Date, default: Date.now },
            },
        ],
    },
    {
        timestamps: true,
    }
);

userSchema.pre('save', async function hashPassword() {
    if (!this.isModified('password')) {
        return;
    }

    this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);

module.exports = User;

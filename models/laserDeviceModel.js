const mongoose = require('mongoose');

/**
 * Platform-approved laser devices. Studios select from this catalog;
 * they cannot edit master records.
 */
const laserDeviceSchema = new mongoose.Schema(
    {
        manufacturer: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
            index: true,
        },
        model: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
            index: true,
        },
        wavelengths_nm: {
            type: [Number],
            default: [],
            validate: {
                validator: (arr) =>
                    Array.isArray(arr) &&
                    arr.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0),
                message: 'wavelengths_nm must be positive numbers',
            },
        },
        notes: {
            type: String,
            default: '',
            maxlength: 2000,
            trim: true,
        },
        active: {
            type: Boolean,
            default: true,
            index: true,
        },
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        updated_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

laserDeviceSchema.index(
    { manufacturer: 1, model: 1 },
    { unique: true, collation: { locale: 'en', strength: 2 } }
);

const LaserDevice = mongoose.model('LaserDevice', laserDeviceSchema);

module.exports = LaserDevice;

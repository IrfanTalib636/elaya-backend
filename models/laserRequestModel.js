const mongoose = require('mongoose');

/**
 * Studio request for a laser not yet in the master catalog.
 */
const laserRequestSchema = new mongoose.Schema(
    {
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        requested_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        manufacturer: { type: String, required: true, trim: true, maxlength: 120 },
        model: { type: String, required: true, trim: true, maxlength: 120 },
        wavelengths_nm: { type: [Number], default: [] },
        notes: { type: String, default: '', maxlength: 2000 },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected'],
            default: 'pending',
            index: true,
        },
        admin_note: { type: String, default: '', maxlength: 2000 },
        resolved_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        resolved_at: { type: Date, default: null },
        laser_device: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'LaserDevice',
            default: null,
        },
    },
    { timestamps: true }
);

const LaserRequest = mongoose.model('LaserRequest', laserRequestSchema);

module.exports = LaserRequest;

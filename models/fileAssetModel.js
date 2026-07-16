const mongoose = require('mongoose');
const { FILE_STATUS, FILE_PURPOSE } = require('../config/storageConfig');

const fileAssetSchema = new mongoose.Schema(
    {
        studio: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            index: true,
        },
        case: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            index: true,
        },
        session: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Session',
        },
        purpose: {
            type: String,
            enum: Object.values(FILE_PURPOSE),
            required: true,
        },
        slot: {
            type: String,
            default: '',
        },
        original_name: { type: String, default: '' },
        mime_type: { type: String, required: true },
        size_bytes: { type: Number, required: true },
        storage_path: { type: String, required: true },
        status: {
            type: String,
            enum: Object.values(FILE_STATUS),
            default: FILE_STATUS.STAGING,
            index: true,
        },
        uploaded_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        expires_at: { type: Date },
    },
    { timestamps: true }
);

fileAssetSchema.index({ status: 1, expires_at: 1 });

module.exports = mongoose.model('FileAsset', fileAssetSchema);

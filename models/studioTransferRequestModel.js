const mongoose = require('mongoose');
const { STUDIO_TRANSFER_STATUS } = require('../config/constants');

const studioTransferRequestSchema = new mongoose.Schema(
    {
        customer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            required: true,
            index: true,
        },
        kunde_name: {
            type: String,
            trim: true,
            default: '',
        },
        von_firma_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        von_firma_name: {
            type: String,
            trim: true,
            default: '',
        },
        zu_firma_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Studio',
            required: true,
            index: true,
        },
        zu_firma_name: {
            type: String,
            trim: true,
            default: '',
        },
        status: {
            type: String,
            enum: Object.values(STUDIO_TRANSFER_STATUS),
            default: STUDIO_TRANSFER_STATUS.AUSSTEHEND,
            index: true,
        },
        /** Customer consent checkboxes (prototype: 3 required) */
        einwilligung_akte: { type: Boolean, default: false },
        einwilligung_datenschutz: { type: Boolean, default: false },
        einwilligung_bestaetigung: { type: Boolean, default: false },
        /** Base64 data URI or relative storage path */
        einwilligung_unterschrift: {
            type: String,
            default: '',
        },
        einwilligung_datum: {
            type: Date,
            default: null,
        },
        ablehnungsgrund: {
            type: String,
            trim: true,
            default: '',
        },
        bearbeitet_am: {
            type: Date,
            default: null,
        },
        genehmigt_am: {
            type: Date,
            default: null,
        },
        genehmigt_von: {
            type: String,
            trim: true,
            default: '',
        },
        bearbeitet_von_user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

studioTransferRequestSchema.index({ customer: 1, status: 1 });
studioTransferRequestSchema.index({ zu_firma_id: 1, status: 1, createdAt: -1 });

const StudioTransferRequest = mongoose.model(
    'StudioTransferRequest',
    studioTransferRequestSchema
);

module.exports = StudioTransferRequest;

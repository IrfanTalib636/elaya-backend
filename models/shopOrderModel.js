const mongoose = require('mongoose');
const { SHOP_ORDER_STATUS } = require('../config/constants');

const shopOrderItemSchema = new mongoose.Schema(
    {
        produkt_id: { type: String, trim: true, default: '' },
        produkt_name: { type: String, required: true, trim: true },
        menge: { type: Number, required: true, min: 1 },
        preis_chf: { type: Number, required: true, min: 0 },
    },
    { _id: false }
);

const shopOrderSchema = new mongoose.Schema(
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
            required: true,
            index: true,
        },
        order_number: {
            type: String,
            trim: true,
            default: '',
        },
        produkte: {
            type: [shopOrderItemSchema],
            default: [],
        },
        total_chf: {
            type: Number,
            required: true,
            min: 0,
        },
        versandkosten: {
            type: Number,
            default: 0,
            min: 0,
        },
        lieferland: {
            type: String,
            trim: true,
            default: 'Schweiz',
        },
        provision_prozent: {
            type: Number,
            default: 25,
            min: 0,
        },
        provision_betrag: {
            type: Number,
            default: 0,
            min: 0,
        },
        zahlungsart: {
            type: String,
            trim: true,
            default: 'karte',
        },
        status: {
            type: String,
            enum: Object.values(SHOP_ORDER_STATUS),
            default: SHOP_ORDER_STATUS.BESTELLT,
            index: true,
        },
    },
    { timestamps: true }
);

shopOrderSchema.index({ studio: 1, createdAt: -1 });

const ShopOrder = mongoose.model('ShopOrder', shopOrderSchema);

module.exports = ShopOrder;

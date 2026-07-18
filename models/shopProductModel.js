const mongoose = require('mongoose');
const { SHOP_CATEGORIES } = require('../config/shopDefaults');

const shopProductSchema = new mongoose.Schema(
    {
        product_code: {
            type: String,
            required: true,
            trim: true,
            unique: true,
            index: true,
        },
        artikelnummer: {
            type: String,
            required: true,
            trim: true,
            unique: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        beschreibung: {
            type: String,
            trim: true,
            default: '',
        },
        preis_chf: {
            type: Number,
            required: true,
            min: 0,
        },
        kategorie: {
            type: String,
            enum: SHOP_CATEGORIES,
            default: 'Sonstiges',
            index: true,
        },
        ean: {
            type: String,
            trim: true,
            default: '',
        },
        ursprung: {
            type: String,
            trim: true,
            default: '',
        },
        /** Optional public image URL or data URI — empty = client placeholder */
        bild_url: {
            type: String,
            trim: true,
            default: '',
        },
        lagerbestand: {
            type: Number,
            default: null,
            min: 0,
        },
        aktiv: {
            type: Boolean,
            default: true,
            index: true,
        },
        sort_order: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }
);

shopProductSchema.index({ aktiv: 1, sort_order: 1 });

const ShopProduct = mongoose.model('ShopProduct', shopProductSchema);

module.exports = ShopProduct;

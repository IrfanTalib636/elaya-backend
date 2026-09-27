const mongoose = require('mongoose');

/**
 * Platform-wide general promotion — applies to ALL active shop products
 * (except products with `rabatt.exclude_from_general = true` or ids listed
 * in `exclude_product_ids`), for the given date range.
 *
 * Only one general promotion is expected to be "live" at a time in practice,
 * but admins may keep several drafts/scheduled promos. Pricing resolution
 * picks the most recently created promotion that is `aktiv` and currently
 * within its date range.
 */
const shopPromotionSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        aktiv: {
            type: Boolean,
            default: true,
            index: true,
        },
        typ: {
            type: String,
            enum: ['percent', 'fixed'],
            default: 'percent',
        },
        wert: {
            type: Number,
            required: true,
            min: 0,
        },
        /** Currency for fixed-amount promotions — only applied to products in the same currency. */
        waehrung: {
            type: String,
            enum: ['CHF', 'EUR'],
            default: 'CHF',
        },
        von: {
            type: Date,
            default: null,
        },
        bis: {
            type: Date,
            default: null,
        },
        exclude_product_ids: {
            type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ShopProduct' }],
            default: [],
        },
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    { timestamps: true }
);

shopPromotionSchema.index({ aktiv: 1, von: 1, bis: 1 });

const ShopPromotion = mongoose.model('ShopPromotion', shopPromotionSchema);

module.exports = ShopPromotion;

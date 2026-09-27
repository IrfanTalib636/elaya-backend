const mongoose = require('mongoose');

/** Per-product discount — independent from the platform-wide ShopPromotion. */
const productDiscountSchema = new mongoose.Schema(
    {
        aktiv: {
            type: Boolean,
            default: false,
        },
        typ: {
            type: String,
            enum: ['percent', 'fixed'],
            default: 'percent',
        },
        /** Percent (0–100) or fixed amount in the product's own currency. */
        wert: {
            type: Number,
            default: 0,
            min: 0,
        },
        von: {
            type: Date,
            default: null,
        },
        bis: {
            type: Date,
            default: null,
        },
        /**
         * When true, this product discount is combined with an active general
         * promotion (applied sequentially: general first, then product).
         * Default OFF — non-stackable products only ever apply the better of
         * "their own discount" (wins when active) or the general promo.
         */
        stackable_with_general: {
            type: Boolean,
            default: false,
        },
        /** When true, this product never receives the general promotion at all. */
        exclude_from_general: {
            type: Boolean,
            default: false,
        },
    },
    { _id: false }
);

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
        /**
         * List price in `waehrung`. Field name kept for backward compatibility
         * (historically CHF-only) — now represents "price in the product's
         * selected currency".
         */
        preis_chf: {
            type: Number,
            required: true,
            min: 0,
        },
        /** Product currency — CHF or EUR. */
        waehrung: {
            type: String,
            enum: ['CHF', 'EUR'],
            default: 'CHF',
        },
        kategorie: {
            type: String,
            trim: true,
            default: 'Sonstiges',
            index: true,
        },
        /** Individual product discount — see productDiscountSchema. */
        rabatt: {
            type: productDiscountSchema,
            default: () => ({}),
        },
        ean: {
            type: String,
            trim: true,
            default: '',
        },
        /** Country of origin. */
        ursprung: {
            type: String,
            trim: true,
            default: '',
        },
        /** Optional public image URL or data URI — empty = client placeholder. Kept as primary/fallback for older clients. */
        bild_url: {
            type: String,
            trim: true,
            default: '',
        },
        /** Full set of product images (uploaded files or external URLs). bild_url mirrors bilder[0]. */
        bilder: {
            type: [String],
            default: [],
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

// Keep bild_url in sync with bilder[0] so old clients (mobile) that only read
// bild_url keep working without changes. Mongoose 9 removed callback-style
// (`next`) hooks — this project's convention is plain sync/async functions.
shopProductSchema.pre('save', function syncBildUrl() {
    if (Array.isArray(this.bilder) && this.bilder.length > 0) {
        this.bild_url = this.bilder[0];
    }
});

const ShopProduct = mongoose.model('ShopProduct', shopProductSchema);

module.exports = ShopProduct;

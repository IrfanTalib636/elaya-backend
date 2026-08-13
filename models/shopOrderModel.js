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

const lieferadresseSchema = new mongoose.Schema(
    {
        vorname: { type: String, trim: true, default: '' },
        nachname: { type: String, trim: true, default: '' },
        strasse: { type: String, trim: true, default: '' },
        plz: { type: String, trim: true, default: '' },
        ort: { type: String, trim: true, default: '' },
        land: { type: String, trim: true, default: 'Schweiz' },
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
        /** Merchandise total (warenwert) — shipping is separate in versandkosten */
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
        lieferadresse: {
            type: lieferadresseSchema,
            default: () => ({}),
        },
        provision_prozent: {
            type: Number,
            // Keep in sync with DEFAULT_SHOP_PROVISION_PROZENT (config/shopDefaults.js)
            default: 20,
            min: 0,
        },
        provision_betrag: {
            type: Number,
            default: 0,
            min: 0,
        },
        /** Studio commission payout tracking (manual until Stripe Connect). */
        commission_status: {
            type: String,
            enum: ['pending', 'paid', 'cancelled'],
            default: 'pending',
            index: true,
        },
        commission_paid_at: {
            type: Date,
            default: null,
        },
        elaya_anteil_chf: {
            type: Number,
            default: 0,
            min: 0,
        },
        elaycoins_redeemed: {
            type: Number,
            default: 0,
            min: 0,
        },
        elaycoins_discount_chf: {
            type: Number,
            default: 0,
            min: 0,
        },
        zahlungsart: {
            type: String,
            trim: true,
            default: 'karte',
        },
        /**
         * Payment is simulated until Stripe keys are configured.
         * Stripe Connect automatic split — pending client credentials.
         */
        zahlung_simuliert: {
            type: Boolean,
            default: true,
        },
        /** pending | requires_payment | paid | failed | cancelled */
        payment_status: {
            type: String,
            enum: ['pending', 'requires_payment', 'paid', 'failed', 'cancelled'],
            default: 'pending',
            index: true,
        },
        stripe_payment_intent_id: {
            type: String,
            trim: true,
            default: '',
            index: true,
        },
        stripe_transfer_id: {
            type: String,
            trim: true,
            default: '',
        },
        paid_at: {
            type: Date,
            default: null,
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
shopOrderSchema.index({ customer: 1, createdAt: -1 });

const ShopOrder = mongoose.model('ShopOrder', shopOrderSchema);

module.exports = ShopOrder;

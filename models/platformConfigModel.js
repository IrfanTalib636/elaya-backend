const mongoose = require('mongoose');
const { PLATFORM_CONFIG_DEFAULTS } = require('../config/platformDefaults');
const { DEFAULT_SESSION_PREDICTION } = require('../config/sessionPredictionDefaults');

const gruppenGroessenSchema = new mongoose.Schema(
    {
        klein_max_cm2: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.gruppen_groessen.klein_max_cm2 },
        mittelgross_max_cm2: {
            type: Number,
            default: PLATFORM_CONFIG_DEFAULTS.gruppen_groessen.mittelgross_max_cm2,
        },
        max_punkte: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.gruppen_groessen.max_punkte },
        gruppen_rabatt: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.gruppen_groessen.gruppen_rabatt },
    },
    { _id: false }
);

/** Builds a strict numeric sub-schema from a defaults block. */
const numericBlockSchema = (block, { min = 0 } = {}) =>
    new mongoose.Schema(
        Object.fromEntries(
            Object.entries(PLATFORM_CONFIG_DEFAULTS[block]).map(([key, value]) => [
                key,
                { type: Number, default: value, min },
            ])
        ),
        { _id: false }
    );

const sperrfristenSchema = numericBlockSchema('sperrfristen');
const terminEinstellungenSchema = numericBlockSchema('termin_einstellungen');

const platformConfigSchema = new mongoose.Schema(
    {
        /** Singleton key — only one document with `platform` */
        key: {
            type: String,
            default: 'platform',
            unique: true,
            immutable: true,
        },
        coinWert: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.coinWert },
        minWert: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.minWert },
        maxWert: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.maxWert },
        deckelProzent: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.deckelProzent },
        verfallMonate: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.verfallMonate },
        grundgebuehr: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.grundgebuehr },
        transaktionsProzent: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.transaktionsProzent },
        zahlungszielTage: { type: Number, default: PLATFORM_CONFIG_DEFAULTS.zahlungszielTage },
        shop_provision_prozent: {
            type: Number,
            default: PLATFORM_CONFIG_DEFAULTS.shop_provision_prozent,
            min: 0,
            max: 100,
        },
        gruppen_groessen: {
            type: gruppenGroessenSchema,
            default: () => ({ ...PLATFORM_CONFIG_DEFAULTS.gruppen_groessen }),
        },
        /** Blocking periods in days — studios may override each value. */
        sperrfristen: {
            type: sperrfristenSchema,
            default: () => ({ ...PLATFORM_CONFIG_DEFAULTS.sperrfristen }),
        },
        /** Appointment durations, booking horizon and lead time. */
        termin_einstellungen: {
            type: terminEinstellungenSchema,
            default: () => ({ ...PLATFORM_CONFIG_DEFAULTS.termin_einstellungen }),
        },
        /** Plan → feature key list */
        subscription_plans: {
            type: mongoose.Schema.Types.Mixed,
            default: () => ({ ...PLATFORM_CONFIG_DEFAULTS.subscription_plans }),
        },
        /** Global feature kill-switches: { [featureKey]: false } disables everywhere */
        feature_global: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        /** Admin-only Sitzungsprognose parameters (Master Excel). Studio may view, not edit. */
        session_prediction: {
            type: mongoose.Schema.Types.Mixed,
            default: () => JSON.parse(JSON.stringify(DEFAULT_SESSION_PREDICTION)),
        },
    },
    {
        timestamps: true,
    }
);

const PlatformConfig = mongoose.model('PlatformConfig', platformConfigSchema);

module.exports = PlatformConfig;

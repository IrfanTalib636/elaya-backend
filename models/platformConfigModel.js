const mongoose = require('mongoose');
const { PLATFORM_CONFIG_DEFAULTS } = require('../config/platformDefaults');

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
        gruppen_groessen: {
            type: gruppenGroessenSchema,
            default: () => ({ ...PLATFORM_CONFIG_DEFAULTS.gruppen_groessen }),
        },
    },
    {
        timestamps: true,
    }
);

const PlatformConfig = mongoose.model('PlatformConfig', platformConfigSchema);

module.exports = PlatformConfig;

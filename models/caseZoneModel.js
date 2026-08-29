const mongoose = require('mongoose');

const caseZoneSchema = new mongoose.Schema(
    {
        case: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            index: true,
        },
        zonen_id: {
            type: String,
            required: true,
            trim: true,
        },
        bezeichnung: { type: String, trim: true, default: '' },
        koerperstelle: { type: String, trim: true, default: '' },
        farben: { type: [String], default: [] },
        dichte: { type: String, default: null },
        /**
         * Measured dimensions per zone. The customer enters these, exactly as
         * for a single-tattoo case; `flaeche_cm2` is derived from them so the
         * pricing engine keeps reading one area field.
         */
        laenge_cm: { type: Number, default: null, min: 0 },
        breite_cm: { type: Number, default: null, min: 0 },
        flaeche_cm2: { type: Number, default: null, min: 0 },
        /** FileAsset id of this zone's intake photo — the fading reference shot. */
        foto_url: { type: String, default: '' },
        preis: { type: Number, default: 0, min: 0 },
        sitzungen_geschaetzt_min: { type: Number, default: 0, min: 0 },
        sitzungen_geschaetzt_max: { type: Number, default: 0, min: 0 },
        /**
         * Treatment progress of this zone, rolled up from its own sessions by
         * `syncZoneSessionStats` — not client-supplied.
         */
        fortschritt_prozent: { type: Number, default: 0, min: 0, max: 100 },
        sitzungen_erledigt: { type: Number, default: 0, min: 0 },
        letzte_sitzung: { type: Date, default: null },
        sperrfrist_bis: { type: Date, default: null },
    },
    {
        timestamps: true,
    }
);

caseZoneSchema.index({ case: 1, zonen_id: 1 }, { unique: true });

const CaseZone = mongoose.model('CaseZone', caseZoneSchema);

module.exports = CaseZone;

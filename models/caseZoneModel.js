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
        flaeche_cm2: { type: Number, default: null, min: 0 },
        flaeche_template: { type: String, default: null },
        flaeche_modus: { type: String, enum: ['template', 'manuell', null], default: null },
        flaeche_manuell: { type: Number, default: null, min: 0 },
        foto_url: { type: String, default: '' },
        preis: { type: Number, default: 0, min: 0 },
        sitzungen_geschaetzt_min: { type: Number, default: 0, min: 0 },
        sitzungen_geschaetzt_max: { type: Number, default: 0, min: 0 },
        fortschritt_prozent: { type: Number, default: 0, min: 0, max: 100 },
        sperrfrist_bis: { type: Date, default: null },
    },
    {
        timestamps: true,
    }
);

caseZoneSchema.index({ case: 1, zonen_id: 1 }, { unique: true });

const CaseZone = mongoose.model('CaseZone', caseZoneSchema);

module.exports = CaseZone;

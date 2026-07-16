const mongoose = require('mongoose');

const anamnesisSchema = new mongoose.Schema(
    {
        case: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Case',
            required: true,
            unique: true,
            index: true,
        },
        ampel_status: {
            type: String,
            enum: ['gruen', 'orange', 'rot', null],
            default: null,
        },
        orange_fragen: { type: [String], default: [] },
        rote_fragen: { type: [String], default: [] },
        antworten: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        wiederholungen: { type: [mongoose.Schema.Types.Mixed], default: [] },
        statuswechsel: { type: [mongoose.Schema.Types.Mixed], default: [] },
        /**
         * Studio review of medical flags — never mutates antworten.
         * Keys: F{frage_nr} → { status, notiz, datum, geklaert_von, bearbeitet_von_id }
         */
        klaerung: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        /** Append-only audit trail for klaerung / freigabe / status changes */
        audit_log: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    {
        timestamps: true,
    }
);

const Anamnesis = mongoose.model('Anamnesis', anamnesisSchema);

module.exports = Anamnesis;

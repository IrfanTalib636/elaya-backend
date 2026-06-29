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
    },
    {
        timestamps: true,
    }
);

const Anamnesis = mongoose.model('Anamnesis', anamnesisSchema);

module.exports = Anamnesis;

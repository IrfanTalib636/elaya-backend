/**
 * Backfill AI estimates (pricePerSession + sessionsMin/Max) for existing cases
 * created before estimates were persisted at creation time.
 *
 * Only touches cases whose estimate is still unconfirmed (estimate_confirmation
 * offen / missing) — studio-confirmed values are never overwritten.
 *
 * Usage: node scripts/backfillEstimates.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Case = require('../models/caseModel');
const CaseZone = require('../models/caseZoneModel');
const { calculateCasePreview } = require('../utils/pricingEngine');
const { getEffectivePricingOverrides } = require('../utils/configService');
const { ESTIMATE_CONFIRMATION_STATUS } = require('../config/constants');

const run = async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const cases = await Case.find({
        $or: [
            { 'estimate_confirmation.status': ESTIMATE_CONFIRMATION_STATUS.OFFEN },
            { 'estimate_confirmation.status': { $exists: false } },
            { estimate_confirmation: null },
        ],
    });

    let updated = 0;
    for (const caseDoc of cases) {
        const pricingInput = caseDoc.toObject();
        if (caseDoc.zonen_aktiv) {
            pricingInput.zonen = await CaseZone.find({ case: caseDoc._id })
                .sort({ zonen_id: 1 })
                .lean();
        }

        const overrides = await getEffectivePricingOverrides(caseDoc.studio);
        const preview = calculateCasePreview(pricingInput, overrides);

        const price = preview.pricePerSession ?? 0;
        const min = preview.sessions?.min ?? 0;
        const max = preview.sessions?.max ?? 0;

        if (
            caseDoc.pricePerSession === price &&
            caseDoc.sessionsMin === min &&
            caseDoc.sessionsMax === max
        ) {
            continue;
        }

        caseDoc.pricePerSession = price;
        caseDoc.sessions = preview.sessions?.base ?? max;
        caseDoc.sessionsMin = min;
        caseDoc.sessionsMax = max;
        await caseDoc.save();
        updated += 1;
        console.log(
            `${caseDoc.caseId}: CHF ${price}/Sitzung · ${min}–${max} Sitzungen`
        );
    }

    console.log(`Done — ${updated}/${cases.length} cases backfilled.`);
    await mongoose.disconnect();
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});

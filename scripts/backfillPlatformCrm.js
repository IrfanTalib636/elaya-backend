require('dotenv').config();
const mongoose = require('mongoose');
const { backfillPlatformCrm } = require('../utils/platformFunnelEngine');

const run = async () => {
    const uri = process.env.MONGO_URI;
    if (!uri) {
        throw new Error('MONGO_URI is not defined');
    }

    await mongoose.connect(uri);
    console.log('MongoDB connected — starting platform CRM backfill…');

    const result = await backfillPlatformCrm({
        batchSize: 100,
        onProgress: (p) => {
            if (p.type === 'customer') {
                console.log(
                    `  customers: synced ${p.synced}/${p.total} (failed ${p.failed})`
                );
            } else {
                console.log(`  leads: synced ${p.synced}/${p.total} (failed ${p.failed})`);
            }
        },
    });

    console.log('Done.');
    console.log(
        `Customers: ${result.customers.synced}/${result.customers.total} synced, ${result.customers.failed} failed`
    );
    console.log(
        `Studio leads: ${result.leads.synced}/${result.leads.total} synced, ${result.leads.failed} failed`
    );

    await mongoose.disconnect();
};

run().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch {
        /* ignore */
    }
    process.exit(1);
});

/**
 * Dev seed for ElayShop orders (studio order history + analytics shop KPIs).
 *
 * Usage: npm run seed:shop
 * Optional: SEED_STUDIO_CODE=INKFREE
 */
require('dotenv').config();
const connectDB = require('../config/db');
const Studio = require('../models/studioModel');
const Customer = require('../models/customerModel');
const ShopOrder = require('../models/shopOrderModel');
const { SHOP_ORDER_STATUS } = require('../config/constants');
const { DEFAULT_SHOP_PROVISION_PROZENT } = require('../config/shopDefaults');

if (process.env.NODE_ENV === 'production') {
    console.error('seed:shop must not run in production.');
    process.exit(1);
}

const STUDIO_CODE = process.env.SEED_STUDIO_CODE || 'INKFREE';

const PRODUCTS = [
    { produkt_id: 'prod_001', produkt_name: 'Elaya Aftercare Gel', preis_chf: 24.9 },
    { produkt_id: 'prod_002', produkt_name: 'SPF 50+ Sonnenschutz', preis_chf: 32.5 },
    { produkt_id: 'prod_003', produkt_name: 'Reinigungsschaum', preis_chf: 18.9 },
];

const seedShop = async () => {
    await connectDB();

    const studio = await Studio.findOne({ studio_code: STUDIO_CODE });
    if (!studio) {
        console.error(`Studio ${STUDIO_CODE} not found. Run npm run seed:dev first.`);
        process.exit(1);
    }

    const customers = await Customer.find({ aktuelle_firma_id: studio._id }).limit(8).lean();
    if (customers.length === 0) {
        console.error('No customers for studio. Run seed:pagination or create customers first.');
        process.exit(1);
    }

    const existing = await ShopOrder.countDocuments({ studio: studio._id });
    if (existing >= 5) {
        console.log(`Shop orders already seeded (${existing} orders). Skipping.`);
        process.exit(0);
    }

    const now = Date.now();
    const orders = customers.slice(0, 5).map((customer, i) => {
        const product = PRODUCTS[i % PRODUCTS.length];
        const menge = 1 + (i % 2);
        const total = Math.round((product.preis_chf * menge + 6.9) * 100) / 100;
        const provision = Math.round(total * (DEFAULT_SHOP_PROVISION_PROZENT / 100) * 100) / 100;
        const statuses = [
            SHOP_ORDER_STATUS.BESTELLT,
            SHOP_ORDER_STATUS.VERSENDET,
            SHOP_ORDER_STATUS.GELIEFERT,
        ];

        return {
            studio: studio._id,
            customer: customer._id,
            order_number: `ELY-ORD-${String(i + 1).padStart(3, '0')}`,
            produkte: [{ ...product, menge }],
            total_chf: total,
            versandkosten: 6.9,
            lieferland: 'Schweiz',
            provision_prozent: DEFAULT_SHOP_PROVISION_PROZENT,
            provision_betrag: provision,
            zahlungsart: i % 2 === 0 ? 'karte' : 'twint',
            status: statuses[i % 3],
            createdAt: new Date(now - i * 5 * 86400000),
            updatedAt: new Date(now - i * 5 * 86400000),
        };
    });

    await ShopOrder.insertMany(orders);
    console.log(`Created ${orders.length} shop orders for ${studio.firma} (${STUDIO_CODE}).`);
    process.exit(0);
};

seedShop().catch((err) => {
    console.error(err);
    process.exit(1);
});

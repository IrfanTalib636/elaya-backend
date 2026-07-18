/**
 * Seed ElayShop product catalog (ELY-001…ELY-005).
 *
 * Usage: npm run seed:shop-products
 * Safe to re-run — upserts by product_code.
 */
require('dotenv').config();
const connectDB = require('../config/db');
const ShopProduct = require('../models/shopProductModel');
const { DEFAULT_SHOP_PRODUCTS } = require('../config/shopDefaults');

const seed = async () => {
    await connectDB();

    let upserted = 0;
    for (const product of DEFAULT_SHOP_PRODUCTS) {
        await ShopProduct.findOneAndUpdate(
            { product_code: product.product_code },
            { $set: product },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );
        upserted += 1;
    }

    console.log(`Upserted ${upserted} ElayShop products.`);
    process.exit(0);
};

seed().catch((err) => {
    console.error(err);
    process.exit(1);
});

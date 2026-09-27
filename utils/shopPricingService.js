/**
 * ElayShop pricing engine.
 *
 * Resolves the effective (possibly discounted) price for a product given:
 *  - its own product-level discount (rabatt), and
 *  - the currently active platform-wide general promotion.
 *
 * Rules (client spec):
 *  - Stacking is OFF by default per product.
 *  - A product can be excluded from the general promotion entirely
 *    (`rabatt.exclude_from_general`) — in that case only its own discount
 *    (if active/in-date) ever applies.
 *  - A product can opt in to stacking (`rabatt.stackable_with_general`) —
 *    when both the general promo and the product discount are active, the
 *    general promo is applied first, then the product discount on the
 *    resulting price.
 *  - When NOT stackable (default) and both are active: the product's own
 *    discount takes precedence (wins) over the general promo — a product
 *    discount is a deliberate override, so it always wins when active.
 *  - Fixed-amount general promotions only apply to products whose currency
 *    matches the promotion's currency (percent promos apply regardless of
 *    currency).
 */

const ShopProduct = require('../models/shopProductModel');
const ShopPromotion = require('../models/shopPromotionModel');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const isWithinRange = (now, von, bis) => {
    if (von && now < new Date(von)) return false;
    if (bis && now > new Date(bis)) return false;
    return true;
};

const isProductDiscountActive = (rabatt, now) =>
    Boolean(rabatt?.aktiv) && Number(rabatt.wert) > 0 && isWithinRange(now, rabatt.von, rabatt.bis);

const isGeneralPromoActive = (promo, now) =>
    Boolean(promo?.aktiv) && Number(promo.wert) > 0 && isWithinRange(now, promo.von, promo.bis);

const isProductExcludedFromGeneral = (product, promo) => {
    if (!promo) return true;
    if (product.rabatt?.exclude_from_general) return true;
    const excludeIds = (promo.exclude_product_ids || []).map((id) => String(id));
    return excludeIds.includes(String(product._id || product.id));
};

/** Applies a single discount step to a running price. Returns the new price. */
const applyStep = (price, typ, wert) => {
    if (typ === 'percent') {
        return Math.max(0, round2(price * (1 - wert / 100)));
    }
    // fixed
    return Math.max(0, round2(price - wert));
};

/**
 * @param {object} product - lean or mongoose ShopProduct doc.
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @param {object|null} [opts.generalPromo] - active ShopPromotion (or null).
 * @returns {{
 *   original: number,
 *   final: number,
 *   currency: 'CHF'|'EUR',
 *   savings: number,
 *   discount_label: string,
 *   applied: Array<'product'|'general'>,
 * }}
 */
const resolveProductPrice = (product, opts = {}) => {
    const now = opts.now || new Date();
    const generalPromo = opts.generalPromo || null;
    const currency = product.waehrung === 'EUR' ? 'EUR' : 'CHF';
    const original = round2(product.preis_chf);

    const productActive = isProductDiscountActive(product.rabatt, now);
    const excludedFromGeneral = isProductExcludedFromGeneral(product, generalPromo);
    const generalCurrencyOk =
        !generalPromo || generalPromo.typ !== 'fixed' || generalPromo.waehrung === currency;
    const generalActive =
        !excludedFromGeneral && generalCurrencyOk && isGeneralPromoActive(generalPromo, now);

    let price = original;
    const applied = [];

    if (excludedFromGeneral) {
        // Only the product's own discount can ever apply.
        if (productActive) {
            price = applyStep(price, product.rabatt.typ, Number(product.rabatt.wert));
            applied.push('product');
        }
    } else if (product.rabatt?.stackable_with_general) {
        // Stacking explicitly enabled: general first, then product.
        if (generalActive) {
            price = applyStep(price, generalPromo.typ, Number(generalPromo.wert));
            applied.push('general');
        }
        if (productActive) {
            price = applyStep(price, product.rabatt.typ, Number(product.rabatt.wert));
            applied.push('product');
        }
    } else if (productActive) {
        // Non-stackable + product discount active → product wins.
        price = applyStep(price, product.rabatt.typ, Number(product.rabatt.wert));
        applied.push('product');
    } else if (generalActive) {
        // Non-stackable, no product discount → fall back to the general promo.
        price = applyStep(price, generalPromo.typ, Number(generalPromo.wert));
        applied.push('general');
    }

    const final = round2(price);
    const savings = round2(Math.max(0, original - final));

    let discount_label = '';
    if (savings > 0 && original > 0) {
        const singleTyp =
            applied.length === 1
                ? applied[0] === 'product'
                    ? product.rabatt.typ
                    : generalPromo.typ
                : null;
        const singleWert =
            applied.length === 1
                ? applied[0] === 'product'
                    ? Number(product.rabatt.wert)
                    : Number(generalPromo.wert)
                : null;

        if (singleTyp === 'fixed') {
            discount_label = `-${singleWert} ${currency}`;
        } else {
            const pct =
                singleTyp === 'percent'
                    ? Math.round(singleWert)
                    : Math.round((savings / original) * 100);
            discount_label = `-${pct}%`;
        }
    }

    return {
        original,
        final,
        currency,
        savings,
        discount_label,
        applied,
    };
};

/**
 * Loads the currently "live" general promotion (aktiv + in date range),
 * preferring the most recently created one if several qualify.
 */
const getActiveGeneralPromotion = async (now = new Date()) => {
    const candidates = await ShopPromotion.find({ aktiv: true })
        .sort({ createdAt: -1 })
        .lean();
    return (
        candidates.find((p) => isGeneralPromoActive(p, now)) || null
    );
};

/** Convenience: resolve price for a single product id, loading the general promo. */
const resolveProductPriceById = async (productId, opts = {}) => {
    const product = await ShopProduct.findById(productId).lean();
    if (!product) return null;
    const generalPromo = opts.generalPromo ?? (await getActiveGeneralPromotion(opts.now));
    return resolveProductPrice(product, { now: opts.now, generalPromo });
};

module.exports = {
    round2,
    isWithinRange,
    isProductDiscountActive,
    isGeneralPromoActive,
    resolveProductPrice,
    getActiveGeneralPromotion,
    resolveProductPriceById,
};

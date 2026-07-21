const Studio = require('../models/studioModel');
const { refId } = require('./accessHelpers');

/** Studio assignment history with resolved studio names for timeline UI */
const formatFirmaTimeline = async (history = []) => {
    if (!history.length) return [];

    const studioIds = [
        ...new Set(history.map((entry) => refId(entry.firma_id)).filter(Boolean)),
    ];
    const studios = await Studio.find({ _id: { $in: studioIds } }).select('firma').lean();
    const nameById = Object.fromEntries(studios.map((s) => [s._id.toString(), s.firma ?? '']));

    return [...history]
        .sort((a, b) => new Date(a.von) - new Date(b.von))
        .map((entry) => {
            const firmaId = refId(entry.firma_id);
            return {
                firma_id: firmaId,
                firma_name: nameById[firmaId] ?? 'Unbekanntes Studio',
                von: entry.von,
                bis: entry.bis ?? null,
                grund: entry.grund ?? '',
                is_current: entry.bis === null || entry.bis === undefined,
            };
        });
};

const buildStudioEmbed = (firma) => {
    if (!firma || typeof firma !== 'object' || Array.isArray(firma)) {
        return null;
    }
    return {
        id: firma._id ? String(firma._id) : refId(firma),
        firma: firma.firma ?? '',
        studio_code: firma.studio_code ?? '',
        ort: firma.ort ?? '',
    };
};

const formatCustomerProfileForMe = async (customer) => {
    const firma = customer.aktuelle_firma_id;
    const studioEmbed = buildStudioEmbed(firma);
    const firma_timeline = await formatFirmaTimeline(customer.firma_history ?? []);

    return {
        ...customer,
        id: customer._id,
        aktuelle_firma_id:
            firma && typeof firma === 'object' && firma._id ? firma._id : customer.aktuelle_firma_id,
        studio: studioEmbed,
        aktuelle_firma: studioEmbed,
        firma_timeline,
        firma_history: firma_timeline,
        elaycoins_balance: customer.elaycoins?.balance ?? 0,
    };
};

module.exports = {
    formatFirmaTimeline,
    buildStudioEmbed,
    formatCustomerProfileForMe,
};

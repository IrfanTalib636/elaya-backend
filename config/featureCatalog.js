/**
 * Platform feature catalog — toggled globally / per plan / per studio.
 * Clients should gate UX with GET /config/features/effective (or public subset).
 */

const FEATURE_CATALOG = [
    { key: 'booking', label: 'Termine / Booking', category: 'core' },
    { key: 'cases', label: 'Fälle / Cases', category: 'core' },
    { key: 'anamnesis', label: 'Anamnese', category: 'core' },
    { key: 'elaycoins', label: 'Elaycoins', category: 'engagement' },
    { key: 'elayshop', label: 'ElayShop', category: 'commerce' },
    { key: 'group_booking', label: 'Gruppenbuchung', category: 'booking' },
    { key: 'crm', label: 'CRM / Pipeline', category: 'studio' },
    { key: 'analytics', label: 'Analytics', category: 'studio' },
    { key: 'messaging', label: 'Studio-Chat', category: 'communication' },
    { key: 'ai_nachsorge', label: 'KI Nachsorge', category: 'ai' },
    { key: 'ai_chat', label: 'Elaya KI Chat', category: 'ai' },
    { key: 'ai_verblassung', label: 'KI Verblassung', category: 'ai' },
    { key: 'studio_transfer', label: 'Studio-Wechsel', category: 'platform' },
];

const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key);

const SUBSCRIPTION_PLAN_KEYS = ['basic', 'professional', 'enterprise'];

module.exports = {
    FEATURE_CATALOG,
    FEATURE_KEYS,
    SUBSCRIPTION_PLAN_KEYS,
};

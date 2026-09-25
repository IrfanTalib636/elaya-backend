/**
 * Thin re-export — runtime entry used by routes / scheduler.
 */
const {
    checkAutomationsForCustomer,
    runAutomationsBatch,
    TRIGGER_TYPES,
    BUILTIN_TRIGGERS,
    mergeEffectiveAutomations,
} = (() => {
    const engine = require('./automationsEngine');
    const { mergeEffectiveAutomations } = require('./configService');
    return { ...engine, mergeEffectiveAutomations };
})();

module.exports = {
    checkAutomationsForCustomer,
    runAutomationsBatch,
    TRIGGER_TYPES,
    BUILTIN_TRIGGERS,
    mergeEffectiveAutomations,
};

/**
 * Emit platform config updates so studio/admin/mobile clients refresh live.
 */
const { getIO } = require('./io');

const PLATFORM_CONFIG_ROOM = 'config:platform';

const emitSessionPredictionUpdated = (payload = {}) => {
    try {
        const io = getIO();
        if (!io) return;
        io.to(PLATFORM_CONFIG_ROOM).emit('config:session_prediction_updated', {
            updated_at: new Date().toISOString(),
            ...payload,
        });
    } catch {
        // REST save must succeed even if fan-out fails
    }
};

module.exports = {
    PLATFORM_CONFIG_ROOM,
    emitSessionPredictionUpdated,
};

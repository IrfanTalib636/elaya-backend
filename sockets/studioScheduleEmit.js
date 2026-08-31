/**
 * Studio opening-hours / schedule updates → booking clients refresh live.
 */
const { getIO } = require('./io');

const availabilityStudioRoom = (studioId) => `availability:studio:${String(studioId)}`;

const emitStudioScheduleUpdated = (studioId, payload = {}) => {
    if (!studioId) return;
    try {
        const io = getIO();
        if (!io) return;
        io.to(availabilityStudioRoom(studioId)).emit('studio:schedule_updated', {
            studio_id: String(studioId),
            updated_at: new Date().toISOString(),
            ...payload,
        });
    } catch {
        // REST save must succeed even if fan-out fails
    }
};

module.exports = {
    availabilityStudioRoom,
    emitStudioScheduleUpdated,
};

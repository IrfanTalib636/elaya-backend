/**
 * Anything that changes a customer's blocking periods → their app refreshes the
 * earliest bookable date of *every* case.
 *
 * Blocking periods are computed across all cases of one customer (cross-case
 * rules), so a change on case A moves the earliest date of case B. The event is
 * therefore scoped to the customer, not to a single case, and carries no data
 * beyond the trigger: clients refetch the availability endpoint, which is the
 * only place the rules live.
 */
const { getIO } = require('./io');
const { availabilityStudioRoom } = require('./studioScheduleEmit');

const availabilityCustomerRoom = (customerId) => `availability:customer:${String(customerId)}`;

const emitCustomerAvailabilityChanged = (customerId, payload = {}) => {
    if (!customerId) return;
    try {
        const io = getIO();
        if (!io) return;
        io.to(availabilityCustomerRoom(customerId)).emit('customer:availability_changed', {
            customer_id: String(customerId),
            updated_at: new Date().toISOString(),
            ...payload,
        });
    } catch {
        // The REST request must succeed even if fan-out fails; clients still
        // refetch on their own mutations and on screen remount.
    }
};

/**
 * Same trigger, seen from the studio side: the dashboard shows the earliest
 * bookable date and blocking periods of the cases it treats, so it needs the
 * event too. Studio sockets only ever join their own studio room, never a
 * customer one, hence the separate fan-out.
 */
const emitStudioAvailabilityChanged = (studioId, payload = {}) => {
    if (!studioId) return;
    try {
        const io = getIO();
        if (!io) return;
        io.to(availabilityStudioRoom(studioId)).emit('studio:availability_changed', {
            studio_id: String(studioId),
            updated_at: new Date().toISOString(),
            ...payload,
        });
    } catch {
        // Fan-out is best effort; the dashboard also reloads on navigation.
    }
};

/**
 * One call for both audiences, so a new trigger cannot reach the customer app
 * but silently miss the studio dashboard.
 */
const emitAvailabilityChanged = ({ customerId, studioId, reason }) => {
    emitCustomerAvailabilityChanged(customerId, { reason });
    emitStudioAvailabilityChanged(studioId, { reason, customer_id: customerId ? String(customerId) : null });
};

module.exports = {
    availabilityCustomerRoom,
    emitCustomerAvailabilityChanged,
    emitStudioAvailabilityChanged,
    emitAvailabilityChanged,
};

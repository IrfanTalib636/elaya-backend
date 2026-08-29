const { Server } = require('socket.io');
const { socketAuthMiddleware } = require('./auth');
const { registerChatHandlers } = require('./chatHandler');
const { PLATFORM_CONFIG_ROOM } = require('./configEmit');
const { availabilityStudioRoom } = require('./studioScheduleEmit');
const { availabilityCustomerRoom } = require('./availabilityEmit');
const { setIO } = require('./io');
const { isCustomer, isStudio, refId } = require('../utils/accessHelpers');
const Customer = require('../models/customerModel');
const Case = require('../models/caseModel');

const buildCorsOriginChecker = () => {
    const configured = (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    const defaults = [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:8081',
        'http://127.0.0.1:8081',
    ];
    const allowList = [...new Set([...defaults, ...configured])];

    return (origin, callback) => {
        if (!origin) {
            return callback(null, true);
        }
        if (
            process.env.NODE_ENV !== 'production' &&
            (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/i.test(
                origin
            ) ||
                /^exp:\/\//i.test(origin))
        ) {
            return callback(null, true);
        }
        if (allowList.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`CORS blocked for origin: ${origin}`));
    };
};

const joinAvailabilityRooms = async (socket) => {
    const user = socket.user;
    if (!user) return;

    if (isStudio(user.role) && user.studio_id) {
        socket.join(availabilityStudioRoom(refId(user.studio_id)));
        return;
    }

    if (isCustomer(user.role) && user.customer_id) {
        const customerId = refId(user.customer_id);
        // Blocking periods span all cases of one customer, so a change on any of
        // them has to reach this client.
        socket.join(availabilityCustomerRoom(customerId));
        const [customer, caseStudios] = await Promise.all([
            Customer.findById(customerId).select('aktuelle_firma_id').lean(),
            Case.distinct('studio', { customer: customerId }),
        ]);
        const studioIds = new Set();
        const aktuelle = refId(customer?.aktuelle_firma_id);
        if (aktuelle) studioIds.add(aktuelle);
        for (const sid of caseStudios) {
            const id = refId(sid);
            if (id) studioIds.add(id);
        }
        for (const studioId of studioIds) {
            socket.join(availabilityStudioRoom(studioId));
        }
    }
};

/**
 * Attach Socket.io to the HTTP server for studio ↔ customer live chat.
 * Path: `/socket.io` (default). Auth: handshake.auth.token = access JWT.
 */
const initSocket = (httpServer) => {
    const io = new Server(httpServer, {
        path: process.env.SOCKET_IO_PATH || '/socket.io',
        cors: {
            origin: buildCorsOriginChecker(),
            credentials: true,
        },
        transports: ['websocket', 'polling'],
    });

    setIO(io);

    io.use(socketAuthMiddleware);

    io.on('connection', (socket) => {
        // All authenticated clients receive platform session-prediction updates
        socket.join(PLATFORM_CONFIG_ROOM);
        registerChatHandlers(io, socket);

        void joinAvailabilityRooms(socket).catch(() => {
            // booking refresh still works via pull/refetch
        });

        socket.on('disconnect', () => {
            // rooms cleaned automatically
        });
    });

    console.log(
        `Socket.io live chat ready (path: ${process.env.SOCKET_IO_PATH || '/socket.io'})`
    );

    return io;
};

module.exports = {
    initSocket,
};

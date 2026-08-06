const { Server } = require('socket.io');
const { socketAuthMiddleware } = require('./auth');
const { registerChatHandlers } = require('./chatHandler');
const { setIO } = require('./io');

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
        registerChatHandlers(io, socket);

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

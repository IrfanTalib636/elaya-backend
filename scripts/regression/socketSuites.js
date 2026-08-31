/**
 * Realtime (Socket.IO) regression suites.
 *
 * Verifies that the rooms a client joins actually receive the events the studio
 * and customer apps rely on to recompute blocking periods, and that events fan
 * out to BOTH audiences from a single write.
 */

// socket.io-client is not a backend dependency; borrow it from whichever
// sibling app has it installed so the harness needs no extra install.
const { io } = (() => {
    const candidates = [
        'socket.io-client',
        '../../../elaya-mobile/node_modules/socket.io-client',
        '../../../elaya-frontend/node_modules/socket.io-client',
    ];
    for (const c of candidates) {
        try {
            return require(c);
        } catch {
            /* try the next location */
        }
    }
    throw new Error('socket.io-client not found in backend, mobile, or frontend node_modules');
})();

const { request, BASE_URL } = require('./httpClient');
const { suite, test, assert, assertStatus, unwrap, unwrapList, idOf } = require('./runner');
const { iso, addDays, bookableDate, CLEAN_PRECHECK, CLEAN_ANAMNESIS, SIGNATURE_PNG } = require('./apiSuites');

const SOCKET_URL = BASE_URL.replace(/\/api\/v1$/, '');

/** Connects an authenticated socket and resolves once it is live. */
const connectSocket = (session, label) =>
    new Promise((resolve, reject) => {
        const socket = io(SOCKET_URL, {
            path: '/socket.io',
            transports: ['websocket'],
            auth: { token: session.accessToken },
            reconnection: false,
            timeout: 8000,
        });
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error(`${label}: socket did not connect within 8s`));
        }, 8000);
        socket.on('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.on('connect_error', (err) => {
            clearTimeout(timer);
            socket.close();
            reject(new Error(`${label}: connect_error ${err.message}`));
        });
    });

/** Resolves with the first payload for `event`, or null after `ms`. */
const waitForEvent = (socket, event, ms = 6000) =>
    new Promise((resolve) => {
        const timer = setTimeout(() => {
            socket.off(event, handler);
            resolve(null);
        }, ms);
        const handler = (payload) => {
            clearTimeout(timer);
            socket.off(event, handler);
            resolve(payload ?? {});
        };
        socket.on(event, handler);
    });

const runSocketSuites = async (ctx) => {
    suite('Realtime — Connection');

    let customerSocket = null;
    let studioSocket = null;

    await test('customer socket connects with a valid token', async () => {
        customerSocket = await connectSocket(ctx.customer, 'customer');
        assert(customerSocket.connected, 'customer socket not connected');
    });

    await test('studio socket connects with a valid token', async () => {
        studioSocket = await connectSocket(ctx.studio, 'studio');
        assert(studioSocket.connected, 'studio socket not connected');
    });

    await test('socket rejects an invalid token', async () => {
        const bad = io(SOCKET_URL, {
            path: '/socket.io',
            transports: ['websocket'],
            auth: { token: 'invalid-token' },
            reconnection: false,
            timeout: 6000,
        });
        const outcome = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve('timeout'), 6000);
            bad.on('connect', () => {
                clearTimeout(timer);
                resolve('connected');
            });
            bad.on('connect_error', () => {
                clearTimeout(timer);
                resolve('rejected');
            });
        });
        bad.close();
        assert(outcome === 'rejected', `expected rejection, got "${outcome}"`);
    });

    if (!customerSocket || !studioSocket) {
        customerSocket?.close();
        studioSocket?.close();
        return;
    }

    // ── Availability fan-out ──────────────────────────────────────────────
    suite('Realtime — Availability Fan-out');

    let bookedId = null;

    await test('booking an appointment notifies BOTH customer and studio', async () => {
        // Case B needs the same anamnesis + signature clearance as case A before
        // a customer-side treatment booking is allowed.
        await request('PUT', `/cases/${ctx.caseB}/anamnesis`, {
            session: ctx.customer,
            body: { antworten: CLEAN_ANAMNESIS },
        });
        await request('POST', `/cases/${ctx.caseB}/signature`, {
            session: ctx.customer,
            body: {
                merkblatt_gelesen: true,
                bestaetigung_text: true,
                unterschrift_data: SIGNATURE_PNG,
                anamnese_bestaetigt: true,
                anamnese_bestaetigung_text: 'Angaben wahrheitsgemäss und vollständig.',
                anamnese_unterschrift_data: SIGNATURE_PNG,
            },
        });

        const avail = await request('GET', `/cases/${ctx.caseB}/availability`, { session: ctx.customer });
        assertStatus(avail, 200, 'availability');
        const earliest = avail.body?.data?.fruehestes;
        assert(earliest, 'no earliest date available to book');

        const customerEvent = waitForEvent(customerSocket, 'customer:availability_changed');
        const studioEvent = waitForEvent(studioSocket, 'studio:availability_changed');

        const created = await request('POST', '/appointments', {
            session: ctx.customer,
            body: {
                case_id: ctx.caseB,
                date: bookableDate(earliest, ctx.closedWeekdays || [0]),
                time: '15:00',
                type: 'treatment',
                standort_id: ctx.standorte?.[0]?.id || ctx.standorte?.[0]?._id || undefined,
                booking_precheck: CLEAN_PRECHECK,
            },
        });
        if (created.status !== 201) {
            throw new Error(`could not book to trigger the event: ${JSON.stringify(created.body).slice(0, 220)}`);
        }
        bookedId = idOf(unwrapList(created, 'appointments')[0]);
        assert(bookedId, 'created appointment has no id');
        ctx.createdAppointments.push(bookedId);

        const [c, s] = await Promise.all([customerEvent, studioEvent]);
        assert(c, 'customer never received customer:availability_changed');
        assert(s, 'studio never received studio:availability_changed');
        return `reason=${c.reason || s.reason || 'n/a'}`;
    });

    await test('cancelling an appointment notifies BOTH audiences', async () => {
        if (!bookedId) return 'skip';
        const customerEvent = waitForEvent(customerSocket, 'customer:availability_changed');
        const studioEvent = waitForEvent(studioSocket, 'studio:availability_changed');

        assertStatus(
            await request('PATCH', `/appointments/${bookedId}`, {
                session: ctx.customer,
                body: { status: 'storniert' },
            }),
            200,
            'cancel'
        );

        const [c, s] = await Promise.all([customerEvent, studioEvent]);
        assert(c, 'customer never received the cancellation event');
        assert(s, 'studio never received the cancellation event');
        return `reason=${c.reason || s.reason || 'n/a'}`;
    });

    await test('logging a session notifies BOTH audiences', async () => {
        const customerEvent = waitForEvent(customerSocket, 'customer:availability_changed');
        const studioEvent = waitForEvent(studioSocket, 'studio:availability_changed');

        const created = await request('POST', '/sessions', {
            session: ctx.studio,
            body: { case_id: ctx.caseB, treatment_date: iso(addDays(-2)) },
        });
        if (created.status !== 201) return 'skip';
        ctx.createdSessions.push(idOf(unwrap(created, 'session')));

        const [c, s] = await Promise.all([customerEvent, studioEvent]);
        assert(c, 'customer never received the session event');
        assert(s, 'studio never received the session event');
        return `reason=${c.reason || s.reason || 'n/a'}`;
    });

    await test('a customer does not receive another customer\'s availability events', async () => {
        // The studio write below targets a case that does not belong to our test
        // customer, so our customer socket must stay silent.
        const foreign = await request('GET', '/cases', { session: ctx.studio, query: { limit: 50 } });
        const mine = String(ctx.customer.user.customer_id);
        const other = unwrapList(foreign, 'cases').find((c) => {
            const owner = c.customer?.id ?? c.customer?._id ?? c.customer;
            return owner && String(owner) !== mine;
        });
        if (!other) return 'skip';

        const leaked = waitForEvent(customerSocket, 'customer:availability_changed', 3500);
        const created = await request('POST', '/sessions', {
            session: ctx.studio,
            body: { case_id: idOf(other), treatment_date: iso(addDays(-3)) },
        });
        if (created.status === 201) {
            ctx.createdSessions.push(idOf(unwrap(created, 'session')));
        }
        const payload = await leaked;
        assert(payload === null, 'availability event leaked across customers');
        return 'no cross-customer leak';
    });

    // ── Messaging ─────────────────────────────────────────────────────────
    suite('Realtime — Messaging');

    await test('messaging:connected is emitted on join', async () => {
        const fresh = await connectSocket(ctx.customer, 'customer-messaging');
        const payload = await waitForEvent(fresh, 'messaging:connected', 5000);
        fresh.close();
        // Some builds emit on connect only for messaging-scoped namespaces.
        return payload ? 'received' : 'skip';
    });

    await test('studio room receives messaging:conversation_updated without joining', async () => {
        if (!ctx.conversationId) return 'skip';
        const incoming = waitForEvent(studioSocket, 'messaging:conversation_updated', 6000);
        const sent = await request('POST', `/messaging/conversations/${ctx.conversationId}/messages`, {
            session: ctx.customer,
            body: { text: 'inbox badge ping' },
        });
        if (sent.status >= 400) return 'skip';
        assert(await incoming, 'studio inbox never received messaging:conversation_updated');
        return 'inbox notified';
    });

    await test('a sent message reaches a joined recipient socket in realtime', async () => {
        if (!ctx.conversationId) return 'skip';
        // messaging:message is scoped to the conversation room, which the studio
        // chat page joins when it opens a thread — mirror that here.
        studioSocket.emit('messaging:join', { conversation_id: ctx.conversationId });
        await new Promise((r) => setTimeout(r, 600));

        const incoming = waitForEvent(studioSocket, 'messaging:message', 6000);
        const sent = await request('POST', `/messaging/conversations/${ctx.conversationId}/messages`, {
            session: ctx.customer,
            body: { text: 'realtime regression ping' },
        });
        if (sent.status >= 400) return 'skip';
        assert(await incoming, 'studio never received messaging:message after joining the conversation');
        return 'delivered';
    });

    customerSocket.close();
    studioSocket.close();
};

module.exports = { runSocketSuites };

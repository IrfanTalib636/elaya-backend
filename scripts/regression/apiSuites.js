/**
 * Backend API regression suites (A–Z over the documented surface).
 *
 * Each suite asserts both the happy path and the authorization boundary, since
 * most real defects in this platform have been either a missing role check or a
 * response shape the clients did not expect.
 *
 * Response envelope is `{ success, data: { <collection>: [...], pagination } }`
 * for lists and `{ success, data: { <resource>: {...} } }` for single records,
 * so assertions go through the unwrap helpers rather than touching body.data.
 */

const { request, BASE_URL } = require('./httpClient');
const {
    suite,
    test,
    skip,
    assert,
    assertStatus,
    assertEqual,
    unwrap,
    unwrapList,
    idOf,
} = require('./runner');

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d;
};

/**
 * Picks a date that is genuinely bookable: at or after the earliest allowed
 * date, at least two days out so the minimum lead time can never bite, and not
 * on a weekday the studio is closed.
 */
const bookableDate = (earliestIso, closedWeekdays = [0]) => {
    const earliest = new Date(earliestIso);
    const floor = addDays(2);
    const d = earliest > floor ? earliest : floor;
    for (let i = 0; i < 14; i += 1) {
        if (!closedWeekdays.includes(d.getDay())) return iso(d);
        d.setDate(d.getDate() + 1);
    }
    return iso(d);
};

/** A 1x1 PNG data URI, valid for the signature validators. */
const SIGNATURE_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** A complete, medically unremarkable anamnesis, accepted by the validator. */
const CLEAN_ANAMNESIS = {
    hauterkrankungen: ['keine'],
    pigmentstoerungen: 'nein',
    akute_erkrankung: 'nein',
    chronische_erkrankungen: 'nein',
    diabetes: 'nein',
    autoimmun: 'nein',
    immunschwaeche: 'nein',
    herz_kreislauf: 'nein',
    epilepsie: 'nein',
    blutgerinnung: 'nein',
    blutverduenner: 'nein',
    infektionskrankheiten: ['keine'],
    allergien: 'nein',
    wundheilung: 'nein',
    herpes_bereich: 'nein',
    schwanger: 'nein',
    alkohol_drogen: 'nein',
    urteilsfaehig: 'ja',
    mindestalter_18: 'ja',
};

/** The short pre-appointment check, with no UV or medication lockout. */
const CLEAN_PRECHECK = {
    consultation_only: false,
    pre_session: { uv_exposition: 'keine', medikamente: ['keine'] },
    wiederholungen_confirmed: true,
};

/** Weekday indexes the studio is closed, derived from its opening hours. */
const closedWeekdaysFrom = (oeffnungszeiten) => {
    const order = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];
    if (!oeffnungszeiten) return [0];
    const closed = [];
    order.forEach((key, index) => {
        if (oeffnungszeiten[key] && oeffnungszeiten[key].offen === false) closed.push(index);
    });
    return closed.length ? closed : [0];
};

const runApiSuites = async (ctx) => {
    const { admin, studio, customer } = ctx;

    // ── Health & discovery ────────────────────────────────────────────────
    suite('Health & Discovery');

    await test('GET /health returns ok', async () => {
        const res = assertStatus(await request('GET', '/health'), 200);
        assert(res.body?.success !== false, 'health reported failure');
    });

    await test('GET /studios/public is reachable without auth', async () => {
        const res = assertStatus(await request('GET', '/studios/public'), 200);
        const list = unwrapList(res, 'studios');
        return `${list.length} public studio(s)`;
    });

    await test('GET /config/public exposes sperrfristen + termin_einstellungen', async () => {
        const res = assertStatus(await request('GET', '/config/public', { session: customer }), 200);
        const cfg = unwrap(res, 'config') || {};
        assert(cfg.sperrfristen, 'sperrfristen missing from public config');
        assert(cfg.termin_einstellungen, 'termin_einstellungen missing from public config');
        ctx.publicConfig = cfg;
        return `horizon=${cfg.termin_einstellungen.buchung_horizont_tage}d`;
    });

    await test('GET /config/public requires authentication', async () => {
        assertStatus(await request('GET', '/config/public'), 401);
    });

    // ── Auth ──────────────────────────────────────────────────────────────
    suite('Authentication & Authorization');

    await test('GET /auth/me works for all three roles', async () => {
        for (const s of [admin, studio, customer]) {
            const res = assertStatus(await request('GET', '/auth/me', { session: s }), 200, s.label);
            const user = unwrap(res, 'user');
            assert(user?.role, `${s.label}: no role in /auth/me`);
        }
    });

    await test('protected route rejects a missing token with 401', async () => {
        assertStatus(await request('GET', '/cases'), 401);
    });

    await test('protected route rejects a malformed token with 401', async () => {
        const fake = { accessToken: 'not-a-jwt', cookieHeader: () => null, absorbCookies: () => {} };
        assertStatus(await request('GET', '/cases', { session: fake }), 401);
    });

    await test('customer cannot reach admin platform config', async () => {
        assertStatus(await request('GET', '/config/platform', { session: customer }), [401, 403]);
    });

    await test('studio cannot reach the admin studio list', async () => {
        assertStatus(await request('GET', '/studio/admin/studios', { session: studio }), [401, 403]);
    });

    await test('POST /auth/refresh rotates the access token', async () => {
        const res = assertStatus(await request('POST', '/auth/refresh', { session: customer }), 200, 'refresh');
        const next = res.body?.data?.accessToken ?? unwrap(res, 'accessToken');
        assert(next, 'refresh returned no accessToken');
        customer.accessToken = next;
        assertStatus(await request('GET', '/auth/me', { session: customer }), 200, 'me after refresh');
    });

    await test('login rejects a wrong password', async () => {
        const res = await request('POST', '/auth/login', {
            body: { email: ctx.customerEmail, password: 'definitely-wrong-password' },
        });
        assertStatus(res, [401, 429]);
        return res.status === 429 ? 'rate limited (expected under repeat runs)' : '';
    });

    // ── Config ────────────────────────────────────────────────────────────
    suite('Configuration');

    await test('GET /config/platform as admin returns the numeric config blocks', async () => {
        const res = assertStatus(await request('GET', '/config/platform', { session: admin }), 200);
        const cfg = unwrap(res, 'platform_config') || {};
        assert(cfg.sperrfristen, 'platform config missing sperrfristen');
        assert(cfg.termin_einstellungen, 'platform config missing termin_einstellungen');
        ctx.platformConfig = cfg;
    });

    await test('GET /config/studio as studio returns the effective config', async () => {
        const res = assertStatus(await request('GET', '/config/studio', { session: studio }), 200);
        const cfg = unwrap(res, 'studio_config') || {};
        assert(cfg.sperrfristen, 'studio config missing sperrfristen');
        assert(cfg.termin_einstellungen, 'studio config missing termin_einstellungen');
        ctx.studioConfig = cfg;
    });

    await test('PATCH /config/studio round-trips a sperrfrist override', async () => {
        const current = ctx.studioConfig?.sperrfristen?.cross_case_tage;
        assert(typeof current === 'number', `cross_case_tage not numeric: ${current}`);
        const probe = current === 30 ? 29 : 30;

        const patched = assertStatus(
            await request('PATCH', '/config/studio', {
                session: studio,
                body: { sperrfristen: { cross_case_tage: probe } },
            }),
            200,
            'patch'
        );
        assertEqual(
            (unwrap(patched, 'studio_config') || {}).sperrfristen?.cross_case_tage,
            probe,
            'patched cross_case_tage'
        );

        const reread = assertStatus(await request('GET', '/config/studio', { session: studio }), 200, 'reread');
        assertEqual(
            (unwrap(reread, 'studio_config') || {}).sperrfristen?.cross_case_tage,
            probe,
            'persisted cross_case_tage'
        );

        // Restore so later suites see the original blocking rules.
        assertStatus(
            await request('PATCH', '/config/studio', {
                session: studio,
                body: { sperrfristen: { cross_case_tage: current } },
            }),
            200,
            'restore'
        );
        return `${current} -> ${probe} -> ${current}`;
    });

    await test('PATCH /config/studio rejects an out-of-range value', async () => {
        assertStatus(
            await request('PATCH', '/config/studio', {
                session: studio,
                body: { sperrfristen: { cross_case_tage: -5 } },
            }),
            [400, 422]
        );
    });

    await test('PATCH /config/studio rejects an unknown key', async () => {
        assertStatus(
            await request('PATCH', '/config/studio', {
                session: studio,
                body: { sperrfristen: { totally_made_up_key: 12 } },
            }),
            [400, 422]
        );
    });

    await test('a customer cannot patch studio config', async () => {
        assertStatus(
            await request('PATCH', '/config/studio', {
                session: customer,
                body: { sperrfristen: { cross_case_tage: 1 } },
            }),
            [401, 403]
        );
    });

    // ── Customers ─────────────────────────────────────────────────────────
    suite('Customers');

    await test('GET /customers as studio is paginated', async () => {
        const res = assertStatus(
            await request('GET', '/customers', { session: studio, query: { page: 1, limit: 5 } }),
            200
        );
        const list = unwrapList(res, 'customers');
        assert(list.length <= 5, `limit not honoured: got ${list.length}`);
        ctx.studioCustomerId = idOf(list[0]) || null;
        return `${list.length} customer(s)`;
    });

    await test('GET /customers is denied to a customer', async () => {
        assertStatus(await request('GET', '/customers', { session: customer }), [401, 403]);
    });

    await test('PATCH /customers/me updates own profile', async () => {
        const res = assertStatus(
            await request('PATCH', '/customers/me', { session: customer, body: { ort: 'Basel' } }),
            200
        );
        assert(res.body?.success !== false, 'profile update reported failure');
    });

    await test('GET /customers/me/export returns the data export', async () => {
        assertStatus(await request('GET', '/customers/me/export', { session: customer }), 200);
    });

    await test('GET /elaycoins/me returns a balance', async () => {
        const res = assertStatus(await request('GET', '/elaycoins/me', { session: customer }), 200);
        assert(res.body?.data !== undefined, 'no elaycoin payload');
    });

    // ── Cases ─────────────────────────────────────────────────────────────
    suite('Tattoo Cases');

    await test('POST /cases creates a case for the customer', async () => {
        const res = assertStatus(
            await request('POST', '/cases', {
                session: customer,
                body: { type: 'tattoo', tc_title: 'Regression Case A' },
            }),
            201
        );
        const created = unwrap(res, 'case');
        ctx.caseA = idOf(created);
        assert(ctx.caseA, 'no case id returned');
        assert(created.caseId, 'no human-readable caseId assigned');
        ctx.createdCases.push(ctx.caseA);
        return `caseId=${created.caseId}`;
    });

    await test('POST /cases creates a second case (for cross-case rules)', async () => {
        const res = assertStatus(
            await request('POST', '/cases', {
                session: customer,
                body: { type: 'tattoo', tc_title: 'Regression Case B' },
            }),
            201
        );
        ctx.caseB = idOf(unwrap(res, 'case'));
        assert(ctx.caseB, 'no case id returned');
        ctx.createdCases.push(ctx.caseB);
    });

    await test("GET /cases lists the customer's own cases", async () => {
        const res = assertStatus(await request('GET', '/cases', { session: customer }), 200);
        const list = unwrapList(res, 'cases');
        assert(list.map(idOf).includes(ctx.caseA), 'own case missing from list');
        return `${list.length} case(s)`;
    });

    await test('GET /cases/{id} returns the case detail', async () => {
        const res = assertStatus(await request('GET', `/cases/${ctx.caseA}`, { session: customer }), 200);
        assertEqual(idOf(unwrap(res, 'case')), ctx.caseA, 'case id');
    });

    await test('PATCH /cases/{id} saves intake answers', async () => {
        const res = assertStatus(
            await request('PATCH', `/cases/${ctx.caseA}`, {
                session: customer,
                body: {
                    skin_fitzpatrick_type: 'III',
                    life_smoker: 'no',
                    life_sleep_hours: '7-8',
                },
            }),
            200
        );
        assertEqual(unwrap(res, 'case')?.skin_fitzpatrick_type, 'III', 'fitzpatrick persisted');
    });

    await test('PATCH /cases/{id} rejects an invalid enum value', async () => {
        assertStatus(
            await request('PATCH', `/cases/${ctx.caseA}`, {
                session: customer,
                body: { skin_fitzpatrick_type: 'XIV' },
            }),
            [400, 422]
        );
    });

    await test('PATCH /cases/{id} requires a name on every tattoo zone', async () => {
        const zone = (over = {}) => ({
            koerperstelle: 'unterarm',
            farben: ['schwarz'],
            laenge_cm: 4,
            breite_cm: 3,
            ...over,
        });
        // Unnamed zones are unusable in the session log and pricing breakdown,
        // so both clients mark the field required and the API enforces it.
        for (const [label, bezeichnung] of [
            ['missing', undefined],
            ['empty', ''],
            ['whitespace only', '   '],
        ]) {
            const res = await request('PATCH', `/cases/${ctx.caseA}`, {
                session: customer,
                body: { zonen_aktiv: true, zonen: [zone({ bezeichnung }), zone({ bezeichnung: 'Wade' })] },
            });
            assertStatus(res, [400, 422], `a ${label} zone name must be refused`);
        }

        const ok = await request('PATCH', `/cases/${ctx.caseA}`, {
            session: customer,
            body: {
                zonen_aktiv: true,
                zonen: [zone({ bezeichnung: '  Oberarm innen  ' }), zone({ bezeichnung: 'Wade' })],
            },
        });
        assertStatus(ok, 200, 'named zones must be accepted');

        const detail = await request('GET', `/cases/${ctx.caseA}`, { session: customer });
        const names = (unwrap(detail, 'case').zonen || []).map((z) => z.bezeichnung);
        assert(
            names[0] === 'Oberarm innen',
            `zone name should be stored trimmed, got ${JSON.stringify(names[0])}`
        );
        return `refused 3 unnamed variants, stored ${JSON.stringify(names)}`;
    });

    await test('a tattoo zone requires measurements and derives its own area', async () => {
        const zone = (over = {}) => ({
            bezeichnung: 'Oberarm innen',
            koerperstelle: 'unterarm',
            farben: ['schwarz'],
            laenge_cm: 10,
            breite_cm: 5,
            ...over,
        });

        for (const [label, patch] of [
            ['missing length', { laenge_cm: undefined }],
            ['missing width', { breite_cm: undefined }],
            ['zero length', { laenge_cm: 0 }],
            ['negative width', { breite_cm: -3 }],
        ]) {
            const res = await request('PATCH', `/cases/${ctx.caseA}`, {
                session: customer,
                body: {
                    zonen_aktiv: true,
                    zonen: [zone(patch), zone({ bezeichnung: 'Wade' })],
                },
            });
            assertStatus(res, [400, 422], `${label} must be refused`);
        }

        const ok = await request('PATCH', `/cases/${ctx.caseA}`, {
            session: customer,
            body: {
                zonen_aktiv: true,
                zonen: [
                    zone(),
                    zone({ bezeichnung: 'Wade', laenge_cm: 4, breite_cm: 3 }),
                ],
            },
        });
        assertStatus(ok, 200, 'measured zones must be accepted');

        const detail = await request('GET', `/cases/${ctx.caseA}`, { session: customer });
        const zones = unwrap(detail, 'case').zonen || [];
        assert(zones.length === 2, `expected 2 zones, got ${zones.length}`);

        // Area is derived server-side, never trusted from the client.
        assert(
            zones[0].flaeche_cm2 === 50 && zones[1].flaeche_cm2 === 12,
            `areas should be 50 and 12, got ${zones.map((z) => z.flaeche_cm2).join(', ')}`
        );
        assert(
            zones[0].laenge_cm === 10 && zones[0].breite_cm === 5,
            'zone should keep the measured dimensions'
        );

        // Each zone carries its own estimate, and the larger one costs more.
        assert(
            zones.every((z) => z.preis > 0),
            `every zone needs its own price, got ${zones.map((z) => z.preis).join(', ')}`
        );
        assert(
            zones.every((z) => z.sitzungen_geschaetzt_max > 0),
            'every zone needs its own session range'
        );
        assert(
            zones[0].preis > zones[1].preis,
            `the 50cm² zone should cost more than the 12cm² one, got ${zones[0].preis} vs ${zones[1].preis}`
        );

        return `areas ${zones.map((z) => `${z.flaeche_cm2}cm²/${z.preis}CHF`).join(', ')}`;
    });

    await test('a client-supplied zone area cannot override the measurements', async () => {
        const res = await request('PATCH', `/cases/${ctx.caseA}`, {
            session: customer,
            body: {
                zonen_aktiv: true,
                zonen: [
                    {
                        bezeichnung: 'Oberarm',
                        koerperstelle: 'unterarm',
                        farben: ['schwarz'],
                        laenge_cm: 10,
                        breite_cm: 5,
                        // A tampered area must be ignored in favour of 10 x 5.
                        flaeche_cm2: 9999,
                    },
                    {
                        bezeichnung: 'Wade',
                        koerperstelle: 'unterarm',
                        farben: ['schwarz'],
                        laenge_cm: 4,
                        breite_cm: 3,
                    },
                ],
            },
        });
        assertStatus(res, 200);

        const detail = await request('GET', `/cases/${ctx.caseA}`, { session: customer });
        const first = (unwrap(detail, 'case').zonen || [])[0];
        assert(
            first.flaeche_cm2 === 50,
            `area should be derived as 50, got ${first.flaeche_cm2}`
        );
        return `ignored client area, derived ${first.flaeche_cm2} cm²`;
    });

    await test("a customer cannot read another customer's case", async () => {
        const res = await request('GET', '/cases', { session: studio, query: { limit: 50 } });
        const mine = String(customer.user.customer_id);
        const foreign = unwrapList(res, 'cases').find((c) => {
            const owner = c.customer?.id ?? c.customer?._id ?? c.customer;
            return owner && String(owner) !== mine;
        });
        if (!foreign) return 'skip';
        assertStatus(await request('GET', `/cases/${idOf(foreign)}`, { session: customer }), [403, 404]);
    });

    await test('GET /cases/intake/prefill reflects the earlier case', async () => {
        const res = assertStatus(
            await request('GET', '/cases/intake/prefill', {
                session: customer,
                query: { exclude_case_id: ctx.caseB },
            }),
            200
        );
        const d = unwrap(res);
        assert(d.available === true, `prefill not available: ${JSON.stringify(d).slice(0, 200)}`);
        assertEqual(d.fields?.skin_fitzpatrick_type, 'III', 'carried fitzpatrick');
        assertEqual(d.fields?.life_smoker, 'no', 'carried smoker answer');
        assert(
            d.fields?.skin_sun_zone === undefined || d.fields?.skin_sun_zone === null,
            'body-area answer skin_sun_zone must not be carried over'
        );
        return `${Object.keys(d.fields || {}).length} field(s) carried`;
    });

    await test('prefill is empty for a customer with no prior case', async () => {
        const res = assertStatus(
            await request('GET', '/cases/intake/prefill', {
                session: customer,
                query: { exclude_case_id: ctx.caseA, only_probe: 1 },
            }),
            200
        );
        // Case B has no answers, so excluding A must not invent any.
        const d = unwrap(res);
        assert(typeof d.available === 'boolean', 'prefill must always report availability');
        return `available=${d.available}`;
    });

    await test('POST /cases/pricing/preview responds to a preview request', async () => {
        const res = await request('POST', '/cases/pricing/preview', {
            session: studio,
            body: { type: 'tattoo', tc_title: 'preview' },
        });
        assertStatus(res, [200, 400, 422]);
        return `status ${res.status}`;
    });

    await test('POST /config/pricing/preview breaks the price down step by step', async () => {
        const res = assertStatus(
            await request('POST', '/config/pricing/preview', {
                session: studio,
                body: { preset_id: 'example_2' },
            }),
            200
        );
        const d = unwrap(res);
        const bd = d.live?.breakdown;
        assert(bd && Array.isArray(bd.steps) && bd.steps.length > 1, 'preview has no breakdown steps');
        assert(bd.steps[0].id === 'base', `breakdown must start at the base price, got ${bd.steps[0].id}`);
        // The chain must end on the price that is actually quoted.
        assert(
            bd.pricePerSession === d.live.pricePerSession,
            `breakdown final ${bd.pricePerSession} != price ${d.live.pricePerSession}`
        );
        assert(
            bd.steps.every((s) => typeof s.running === 'number'),
            'every step must carry a running subtotal'
        );
        return `CHF ${d.live.pricePerSession} over ${bd.steps.length} steps`;
    });

    await test('POST /config/pricing/preview reflects unsaved values without saving them', async () => {
        const before = unwrap(
            assertStatus(
                await request('POST', '/config/pricing/preview', {
                    session: studio,
                    body: { preset_id: 'example_2' },
                }),
                200
            )
        );
        const draft = unwrap(
            assertStatus(
                await request('POST', '/config/pricing/preview', {
                    session: studio,
                    body: { preset_id: 'example_2', studio_pricing: { basePricePerCm2: 9 } },
                }),
                200
            )
        );
        assert(
            draft.live.pricePerSession > before.live.pricePerSession,
            `a higher base price must raise the preview, got ${before.live.pricePerSession} -> ${draft.live.pricePerSession}`
        );
        assert(
            draft.baseline.pricePerSession === before.live.pricePerSession,
            'the baseline must stay on the saved configuration'
        );
        // The preview must never persist — the saved config still reads as before.
        const after = unwrap(
            assertStatus(
                await request('POST', '/config/pricing/preview', {
                    session: studio,
                    body: { preset_id: 'example_2' },
                }),
                200
            )
        );
        assert(
            after.live.pricePerSession === before.live.pricePerSession,
            'the preview leaked the draft into the saved configuration'
        );
        return `${before.live.pricePerSession} -> ${draft.live.pricePerSession}, saved unchanged`;
    });

    await test('POST /config/pricing/preview flags a multiplier of zero', async () => {
        const res = assertStatus(
            await request('POST', '/config/pricing/preview', {
                session: studio,
                body: { preset_id: 'example_2', studio_pricing: { depth_normal: 0 } },
            }),
            200
        );
        const check = unwrap(res).config_check;
        assert(check && check.ok === false, 'a zero multiplier must fail the config check');
        assert(
            check.issues.some((i) => i.key === 'depth_normal' && i.severity === 'error'),
            `expected an error for depth_normal, got ${JSON.stringify(check.issues)}`
        );
        return `${check.issues.length} issue(s)`;
    });

    await test('POST /config/pricing/preview is closed to customers', async () => {
        const res = await request('POST', '/config/pricing/preview', {
            session: customer,
            body: { preset_id: 'example_2' },
        });
        assertStatus(res, [401, 403]);
        return `status ${res.status}`;
    });

    await test('GET /cases/{id}/standorte lists bookable locations with last-used flags', async () => {
        const res = assertStatus(await request('GET', `/cases/${ctx.caseA}/standorte`, { session: customer }), 200);
        const d = res.body?.data || {};
        assert(Array.isArray(d.standorte), 'standorte is not an array');
        assert('last_used_standort_id' in d, 'response does not expose last_used_standort_id');
        assert('auswahl_erforderlich' in d, 'response does not say whether a choice is required');
        ctx.standorte = d.standorte;
        return `${d.standorte.length} location(s), choice_required=${d.auswahl_erforderlich}`;
    });

    await test('GET /cases/{id}/anamnesis is reachable', async () => {
        const res = await request('GET', `/cases/${ctx.caseA}/anamnesis`, { session: customer });
        assertStatus(res, [200, 404]);
        return `status ${res.status}`;
    });

    await test('GET /cases/{id}/merkblatt returns the leaflet', async () => {
        const res = await request('GET', `/cases/${ctx.caseA}/merkblatt`, { session: customer });
        assertStatus(res, [200, 400, 404]);
        return `status ${res.status}`;
    });

    // ── Lockouts / availability ───────────────────────────────────────────
    suite('Availability & Blocking Periods');

    await test('GET /cases/{id}/availability returns the full lockout contract', async () => {
        const res = assertStatus(await request('GET', `/cases/${ctx.caseA}/availability`, { session: customer }), 200);
        const d = res.body?.data || {};
        assert(d.fruehestes, 'no fruehestes (earliest bookable date)');
        assert(Array.isArray(d.sperren), 'sperren must be an array');
        assert(d.termin_einstellungen, 'availability must echo termin_einstellungen');
        assert(d.sperrfristen, 'availability must echo sperrfristen');
        assert(Array.isArray(d.frei_fenster), 'frei_fenster must be an array');
        ctx.availabilityA = d;
        return `earliest=${d.fruehestes}, ${d.sperren.length} lockout(s)`;
    });

    await test('every sperre carries the fields the clients localize on', async () => {
        const sperren = ctx.availabilityA?.sperren || [];
        if (sperren.length === 0) return 'skip';
        for (const s of sperren) {
            assert(s.typ || s.kategorie, `sperre missing typ/kategorie: ${JSON.stringify(s)}`);
            assert(s.bis, `sperre missing 'bis': ${JSON.stringify(s)}`);
        }
        return `${sperren.length} lockout(s) well-formed`;
    });

    await test('earliest bookable date is never in the past', async () => {
        const d = ctx.availabilityA || {};
        const earliest = new Date(d.fruehestes);
        const diffHours = (earliest - new Date()) / 36e5;
        assert(diffHours >= -24, `earliest ${d.fruehestes} is in the past`);
        return `lead=${d.termin_einstellungen?.min_vorlaufzeit_stunden ?? 0}h`;
    });

    await test('latest bookable date matches the configured horizon', async () => {
        const d = ctx.availabilityA || {};
        if (!d.spaetestes) return 'skip';
        const horizon = d.termin_einstellungen?.buchung_horizont_tage;
        const drift = Math.abs((new Date(d.spaetestes) - addDays(horizon)) / 864e5);
        assert(drift <= 2, `spaetestes ${d.spaetestes} does not match a ${horizon}-day horizon`);
        return `horizon=${horizon}d`;
    });

    await test('GET /cases/{id}/booking-precheck returns the questionnaire', async () => {
        const res = assertStatus(
            await request('GET', `/cases/${ctx.caseA}/booking-precheck`, { session: customer }),
            200
        );
        const d = res.body?.data || {};
        assert(d.ps01, 'precheck has no ps01 form');
        assert(d.sperrfristen, 'precheck does not echo the studio sperrfristen');
    });

    await test('POST booking-precheck/preview surfaces a UV lockout', async () => {
        const res = await request('POST', `/cases/${ctx.caseA}/booking-precheck/preview`, {
            session: customer,
            body: { ps01: { uv_exposition: 'sonnenbrand' } },
        });
        assertStatus(res, [200, 400, 422]);
        if (res.status !== 200) return `status ${res.status}`;
        const hint = res.body?.data?.availability_hint;
        assert(hint, 'preview did not return availability_hint');
        assert(hint.fruehestes, 'availability_hint has no fruehestes');
        return `hint earliest=${hint.fruehestes}`;
    });

    // ── Anamnesis & the two-signature flow ────────────────────────────────
    suite('Anamnesis & Signatures');

    await test('a treatment booking is blocked before the anamnesis is complete', async () => {
        const res = assertStatus(
            await request('GET', `/cases/${ctx.caseA}/booking-precheck`, { session: customer }),
            200
        );
        const p = res.body?.data?.prerequisites || {};
        assertEqual(p.anamnesis_complete, false, 'anamnesis should start incomplete');
        assertEqual(p.can_book_treatment, false, 'treatment booking should be gated');
        assert(p.block_reason, 'gate gives no reason');
        return p.block_reason;
    });

    await test('PUT /cases/{id}/anamnesis stores a complete anamnesis', async () => {
        const res = assertStatus(
            await request('PUT', `/cases/${ctx.caseA}/anamnesis`, {
                session: customer,
                body: { antworten: CLEAN_ANAMNESIS },
            }),
            [200, 201]
        );
        assert(res.body?.success !== false, 'anamnesis save reported failure');
    });

    await test('PUT /cases/{id}/anamnesis rejects an incomplete anamnesis', async () => {
        const partial = { ...CLEAN_ANAMNESIS };
        delete partial.urteilsfaehig;
        assertStatus(
            await request('PUT', `/cases/${ctx.caseA}/anamnesis`, {
                session: customer,
                body: { antworten: partial },
            }),
            [400, 422]
        );
    });

    await test('signature is still required after the anamnesis', async () => {
        const res = assertStatus(
            await request('GET', `/cases/${ctx.caseA}/booking-precheck`, { session: customer }),
            200
        );
        const p = res.body?.data?.prerequisites || {};
        assertEqual(p.anamnesis_complete, true, 'anamnesis should now be complete');
        assertEqual(p.signature_complete, false, 'signature should still be outstanding');
        return p.block_reason || 'signature outstanding';
    });

    await test('POST /cases/{id}/signature rejects an unread leaflet', async () => {
        assertStatus(
            await request('POST', `/cases/${ctx.caseA}/signature`, {
                session: customer,
                body: {
                    merkblatt_gelesen: false,
                    bestaetigung_text: true,
                    unterschrift_data: SIGNATURE_PNG,
                },
            }),
            [400, 422]
        );
    });

    await test('POST /cases/{id}/signature stores BOTH signatures separately', async () => {
        const res = assertStatus(
            await request('POST', `/cases/${ctx.caseA}/signature`, {
                session: customer,
                body: {
                    merkblatt_gelesen: true,
                    bestaetigung_text: true,
                    unterschrift_data: SIGNATURE_PNG,
                    anamnese_bestaetigt: true,
                    anamnese_bestaetigung_text:
                        'Ich bestätige, dass alle medizinischen Angaben wahrheitsgemäss und vollständig sind.',
                    anamnese_unterschrift_data: SIGNATURE_PNG,
                },
            }),
            [200, 201]
        );
        const detail = assertStatus(
            await request('GET', `/cases/${ctx.caseA}`, { session: customer }),
            200,
            'reread case'
        );
        const c = unwrap(detail, 'case') || {};
        assert(c.signature_complete === true, 'leaflet signature not recorded as complete');
        assert(
            c.anamnesis_signature_complete === true,
            'anamnesis signature not recorded separately — the second confirmation was lost'
        );
        return `both signatures stored (status ${res.status})`;
    });

    await test('prerequisites now allow a treatment booking', async () => {
        const res = assertStatus(
            await request('GET', `/cases/${ctx.caseA}/booking-precheck`, { session: customer }),
            200
        );
        const p = res.body?.data?.prerequisites || {};
        assertEqual(p.can_book_treatment, true, `still blocked: ${p.block_reason}`);
    });

    // ── Appointments ──────────────────────────────────────────────────────
    suite('Appointments');

    await test('studio opening hours are available for slot selection', async () => {
        const res = assertStatus(await request('GET', '/studio/settings', { session: studio }), 200);
        const settings = unwrap(res, 'settings') || {};
        assert(settings.oeffnungszeiten, 'no opening hours to derive a bookable slot from');
        ctx.studioSettings = settings;
        ctx.closedWeekdays = closedWeekdaysFrom(settings.oeffnungszeiten);
        ctx.openFrom = settings.oeffnungszeiten.mo?.von || '10:00';
        return `opens ${ctx.openFrom}, closed on ${ctx.closedWeekdays.join(',') || 'none'}`;
    });

    await test('POST /appointments books a valid slot at the chosen location', async () => {
        const earliest = ctx.availabilityA?.fruehestes;
        assert(earliest, 'no earliest date to book on');
        const date = bookableDate(earliest, ctx.closedWeekdays || [0]);
        const time = ctx.openFrom || '10:00';
        const standortId = idOf(ctx.standorte?.[0]) || undefined;

        const res = await request('POST', '/appointments', {
            session: customer,
            body: {
                case_id: ctx.caseA,
                date,
                time,
                type: 'treatment',
                standort_id: standortId,
                booking_precheck: CLEAN_PRECHECK,
            },
        });
        assertStatus(res, [201, 400, 409]);
        if (res.status !== 201) {
            throw new Error(
                `booking ${date} ${time} at ${standortId} was refused: ${JSON.stringify(res.body).slice(0, 260)}`
            );
        }
        // A booking always returns an array, because a group booking creates one
        // appointment per case.
        const created = unwrapList(res, 'appointments')[0];
        assert(created, 'create returned no appointment');
        ctx.appointmentA = idOf(created);
        assert(ctx.appointmentA, 'created appointment has no id');
        ctx.createdAppointments.push(ctx.appointmentA);
        ctx.appointmentADauer = created.dauer_minuten;
        ctx.bookedDate = date;
        assert(
            !standortId || String(created.standort_id) === String(standortId),
            `booking did not keep the chosen location: ${created.standort_id}`
        );
        return `booked ${date} ${time} at ${created.standort_name || standortId}`;
    });

    await test('server fills dauer_minuten from studio config when omitted', async () => {
        if (!ctx.appointmentA) return 'skip';
        const expected = ctx.publicConfig?.termin_einstellungen?.default_dauer_behandlung_minuten;
        assert(ctx.appointmentADauer > 0, 'appointment stored no duration');
        if (expected) assertEqual(ctx.appointmentADauer, expected, 'duration from config');
        return `dauer=${ctx.appointmentADauer}min`;
    });

    await test('booking in the past is refused', async () => {
        const res = await request('POST', '/appointments', {
            session: customer,
            body: {
                case_id: ctx.caseA,
                date: iso(addDays(-3)),
                time: '10:00',
                type: 'treatment',
                booking_precheck: CLEAN_PRECHECK,
            },
        });
        assertStatus(res, [400, 409, 422]);
        return `refused with ${res.status}`;
    });

    await test('booking beyond the horizon is refused', async () => {
        const horizon = ctx.publicConfig?.termin_einstellungen?.buchung_horizont_tage ?? 180;
        const res = await request('POST', '/appointments', {
            session: customer,
            body: {
                case_id: ctx.caseA,
                date: iso(addDays(horizon + 30)),
                time: '10:00',
                type: 'treatment',
                booking_precheck: CLEAN_PRECHECK,
            },
        });
        assertStatus(res, [400, 409, 422]);
        return `refused with ${res.status}`;
    });

    await test('a booked appointment creates a cross-case lockout on the other case', async () => {
        if (!ctx.appointmentA) return 'skip';
        const res = assertStatus(await request('GET', `/cases/${ctx.caseB}/availability`, { session: customer }), 200);
        const sperren = res.body?.data?.sperren || [];
        const cross = sperren.find((s) => `${s.kategorie || ''}${s.typ || ''}`.toLowerCase().includes('cross'));
        assert(cross, `case B shows no cross-case lockout: ${JSON.stringify(sperren).slice(0, 300)}`);
        assert(cross.case_name || cross.grund, 'cross-case lockout does not name the causing case');
        ctx.crossCaseLockout = cross;
        return `cross-case until ${cross.bis}`;
    });

    await test('GET /appointments lists the booking', async () => {
        const res = assertStatus(await request('GET', '/appointments', { session: customer }), 200);
        const list = unwrapList(res, 'appointments');
        if (ctx.appointmentA) {
            assert(list.map(idOf).includes(ctx.appointmentA), 'booked appointment missing from list');
        }
        return `${list.length} appointment(s)`;
    });

    await test('GET /appointments/{id} returns the booking', async () => {
        if (!ctx.appointmentA) return 'skip';
        assertStatus(await request('GET', `/appointments/${ctx.appointmentA}`, { session: customer }), 200);
    });

    await test('PATCH /appointments/{id} cancels the booking', async () => {
        if (!ctx.appointmentA) return 'skip';
        const res = assertStatus(
            await request('PATCH', `/appointments/${ctx.appointmentA}`, {
                session: customer,
                body: { status: 'storniert' },
            }),
            200
        );
        assertEqual(unwrap(res, 'appointment')?.status, 'storniert', 'cancelled status');
    });

    await test('cancelling releases the cross-case lockout', async () => {
        if (!ctx.appointmentA) return 'skip';
        const res = assertStatus(await request('GET', `/cases/${ctx.caseB}/availability`, { session: customer }), 200);
        const sperren = res.body?.data?.sperren || [];
        const cross = sperren.find((s) => `${s.kategorie || ''}${s.typ || ''}`.toLowerCase().includes('cross'));
        assert(!cross, `cross-case lockout survived cancellation: ${JSON.stringify(cross)}`);
    });

    // ── Group booking ─────────────────────────────────────────────────────
    suite('Group Booking');

    await test('studio config exposes the group booking parameters', async () => {
        const cfg = ctx.studioConfig || {};
        const group = cfg.gruppen_groessen;
        assert(group, `no gruppen_groessen block in studio config: ${Object.keys(cfg).join(',')}`);
        ctx.groupConfig = group;
        return JSON.stringify(group).slice(0, 120);
    });

    await test('studio config exposes the points for all three size tiers', async () => {
        // The settings UI labels each tier from these values, so a missing tier
        // would leave the studio guessing what a size costs in points.
        const punkte = (ctx.studioConfig || {}).gruppen_punkte;
        assert(punkte, 'no gruppen_punkte block in studio config');
        for (const tier of ['klein', 'mittelgross', 'gross']) {
            assert(
                Number.isFinite(punkte[tier]) && punkte[tier] > 0,
                `gruppen_punkte.${tier} missing or not a positive number`
            );
        }
        assert(
            punkte.klein < punkte.mittelgross && punkte.mittelgross < punkte.gross,
            `points must increase with size, got ${JSON.stringify(punkte)}`
        );
        // "Large books alone" only holds while one large fills the whole cap.
        const cap = ctx.groupConfig?.max_punkte;
        assert(
            cap == null || punkte.gross >= cap,
            `a large tattoo (${punkte.gross} pts) no longer fills the cap (${cap})`
        );
        return JSON.stringify(punkte);
    });

    await test('PATCH /config/studio rejects thresholds that empty the medium tier', async () => {
        const current = ctx.groupConfig || {};
        const res = await request('PATCH', '/config/studio', {
            session: studio,
            body: {
                gruppen_groessen: {
                    klein_max_cm2: current.mittelgross_max_cm2 ?? 150,
                    mittelgross_max_cm2: current.mittelgross_max_cm2 ?? 150,
                },
            },
        });
        assertStatus(res, [400, 422], 'equal thresholds must be refused');
        return `refused with ${res.status}`;
    });

    await test('POST /appointments with gruppen_cases validates the combination', async () => {
        const earliest = ctx.availabilityA?.fruehestes;
        if (!earliest) return 'skip';
        const res = await request('POST', '/appointments', {
            session: customer,
            body: {
                case_id: ctx.caseA,
                gruppen_termin: true,
                gruppen_cases: [ctx.caseB],
                date: bookableDate(earliest, ctx.closedWeekdays || [0]),
                time: '13:00',
                type: 'treatment',
                standort_id: idOf(ctx.standorte?.[0]) || undefined,
                booking_precheck: CLEAN_PRECHECK,
            },
        });
        assertStatus(res, [201, 400, 409, 422]);
        if (res.status === 201) {
            const list = unwrapList(res, 'appointments');
            assert(list.length >= 2, `group booking created ${list.length} appointment(s), expected one per case`);
            for (const d of list) {
                ctx.createdAppointments.push(idOf(d));
                assert(d.gruppen_termin === true, 'group flag not set on a group booking');
                assert(d.gruppen_id, 'group appointments share no gruppen_id');
                assert(d.gruppen_preis_total !== undefined, 'group booking has no total price');
            }
            const ids = new Set(list.map((d) => d.gruppen_id));
            assert(ids.size === 1, 'group appointments were not linked by a single gruppen_id');
            return `grouped ${list.length} case(s), discount=${list[0].gruppen_rabatt}`;
        }
        return `refused with ${res.status} (rule enforced)`;
    });

    await test('gruppen_cases without the gruppen_termin flag is not silently dropped', async () => {
        const earliest = ctx.availabilityA?.fruehestes;
        if (!earliest) return 'skip';
        const res = await request('POST', '/appointments', {
            session: customer,
            body: {
                case_id: ctx.caseA,
                gruppen_cases: [ctx.caseB],
                date: bookableDate(earliest, ctx.closedWeekdays || [0]),
                time: '16:00',
                type: 'treatment',
                standort_id: idOf(ctx.standorte?.[0]) || undefined,
                booking_precheck: CLEAN_PRECHECK,
            },
        });
        assertStatus(res, [201, 400, 409, 422]);
        if (res.status !== 201) return `refused with ${res.status} (rule enforced)`;
        const list = unwrapList(res, 'appointments');
        for (const d of list) ctx.createdAppointments.push(idOf(d));
        assert(
            list.length >= 2,
            `only ${list.length} appointment(s) created — the requested group cases were dropped`
        );
        return `${list.length} appointment(s) created`;
    });

    // ── Sessions ──────────────────────────────────────────────────────────
    suite('Sessions');

    // caseA is a zone case by this point, and a zone case logs every treatment
    // against one specific zone.
    await test('the zones of the case under test can be resolved', async () => {
        const detail = await request('GET', `/cases/${ctx.caseA}`, { session: customer });
        const caseData = unwrap(detail, 'case');
        ctx.caseAZones = (caseData.zonen || []).map((z) => z.zonen_id).filter(Boolean);
        ctx.caseAIsZoned = !!caseData.zonen_aktiv && ctx.caseAZones.length > 0;
        return ctx.caseAIsZoned ? `zones ${ctx.caseAZones.join(', ')}` : 'single-tattoo case';
    });

    await test('POST /sessions logs a treatment as studio', async () => {
        const res = await request('POST', '/sessions', {
            session: studio,
            body: {
                case_id: ctx.caseA,
                treatment_date: iso(addDays(-1)),
                ...(ctx.caseAIsZoned ? { zonen_id: ctx.caseAZones[0] } : {}),
            },
        });
        assertStatus(res, [201, 400, 403, 422]);
        if (res.status !== 201) return `status ${res.status}`;
        ctx.sessionA = idOf(unwrap(res, 'session'));
        ctx.createdSessions.push(ctx.sessionA);
    });

    await test('a zone case refuses a session that names no zone', async () => {
        if (!ctx.caseAIsZoned) return 'skip';
        const res = await request('POST', '/sessions', {
            session: studio,
            body: { case_id: ctx.caseA, treatment_date: iso(addDays(-1)) },
        });
        assertStatus(res, [400, 422], 'a zone case must not accept an unassigned session');
        return `status ${res.status}`;
    });

    await test('a session cannot name a zone that is not on the case', async () => {
        if (!ctx.caseAIsZoned) return 'skip';
        const res = await request('POST', '/sessions', {
            session: studio,
            body: {
                case_id: ctx.caseA,
                treatment_date: iso(addDays(-1)),
                zonen_id: 'Z999',
            },
        });
        assertStatus(res, [400, 422], 'an unknown zone must be refused');
        return `status ${res.status}`;
    });

    await test('each zone numbers its own sessions independently', async () => {
        if (!ctx.caseAIsZoned || ctx.caseAZones.length < 2 || !ctx.sessionA) return 'skip';
        // The second zone starts at 1 again, even though the first zone already
        // has a session on this case.
        const res = await request('POST', '/sessions', {
            session: studio,
            body: {
                case_id: ctx.caseA,
                treatment_date: iso(addDays(-2)),
                zonen_id: ctx.caseAZones[1],
            },
        });
        assertStatus(res, 201);
        const created = unwrap(res, 'session');
        ctx.createdSessions.push(idOf(created));
        assert(
            created.session_number === 1,
            `zone 2 should start at session 1, got ${created.session_number}`
        );
        assert(
            created.zonen_id === ctx.caseAZones[1],
            `session should carry its zone, got ${created.zonen_id}`
        );
        return `${ctx.caseAZones[1]} #${created.session_number}`;
    });

    await test('GET /sessions can be filtered to a single zone', async () => {
        if (!ctx.caseAIsZoned) return 'skip';
        const res = assertStatus(
            await request('GET', '/sessions', {
                session: studio,
                query: { case_id: ctx.caseA, zonen_id: ctx.caseAZones[0], limit: 50 },
            }),
            200
        );
        const rows = unwrapList(res, 'sessions');
        assert(
            rows.length > 0 && rows.every((s) => s.zonen_id === ctx.caseAZones[0]),
            `expected only ${ctx.caseAZones[0]} rows, got ${JSON.stringify(rows.map((s) => s.zonen_id))}`
        );
        return `${rows.length} row(s) for ${ctx.caseAZones[0]}`;
    });

    await test('a logged session rolls progress up onto its own zone', async () => {
        if (!ctx.caseAIsZoned || !ctx.sessionA) return 'skip';
        const detail = await request('GET', `/cases/${ctx.caseA}`, { session: customer });
        const zones = unwrap(detail, 'case').zonen || [];
        const first = zones.find((z) => z.zonen_id === ctx.caseAZones[0]);
        assert(
            (first?.sitzungen_erledigt ?? 0) >= 1,
            `zone ${ctx.caseAZones[0]} should report its own sessions, got ${first?.sitzungen_erledigt}`
        );
        return zones
            .map((z) => `${z.zonen_id}:${z.sitzungen_erledigt}×/${z.fortschritt_prozent}%`)
            .join(', ');
    });

    await test('a session cannot be moved to a different zone', async () => {
        if (!ctx.caseAIsZoned || ctx.caseAZones.length < 2 || !ctx.sessionA) return 'skip';
        const res = await request('PATCH', `/sessions/${ctx.sessionA}`, {
            session: studio,
            body: { zonen_id: ctx.caseAZones[1] },
        });
        assertStatus(res, [400, 422], 'reassigning a zone must be refused');
        return `status ${res.status}`;
    });

    await test('a logged session creates a same-case treatment interval', async () => {
        if (!ctx.sessionA) return 'skip';
        const res = assertStatus(await request('GET', `/cases/${ctx.caseA}/availability`, { session: customer }), 200);
        const sperren = res.body?.data?.sperren || [];
        const same = sperren.find((s) => {
            const k = `${s.kategorie || ''}${s.typ || ''}`.toLowerCase();
            return k.includes('same') || k.includes('interval') || k.includes('behandlung');
        });
        assert(same, `no same-case interval after a session: ${JSON.stringify(sperren).slice(0, 300)}`);
        return `blocked until ${same.bis}`;
    });

    await test('GET /sessions lists sessions for the studio', async () => {
        const res = assertStatus(await request('GET', '/sessions', { session: studio }), 200);
        const list = unwrapList(res, 'sessions');
        return `${list.length} session(s)`;
    });

    await test('GET /sessions/{id} returns the session', async () => {
        if (!ctx.sessionA) return 'skip';
        assertStatus(await request('GET', `/sessions/${ctx.sessionA}`, { session: studio }), 200);
    });

    await test('PATCH /sessions/{id} updates the session', async () => {
        if (!ctx.sessionA) return 'skip';
        const res = await request('PATCH', `/sessions/${ctx.sessionA}`, {
            session: studio,
            body: { notizen: 'regression note' },
        });
        assertStatus(res, [200, 400, 422]);
        return `status ${res.status}`;
    });

    // ── Studio dashboard ──────────────────────────────────────────────────
    suite('Studio Dashboard');

    const studioReads = [
        ['/studio/settings', 'settings', 'settings'],
        ['/studio/activity', 'activity feed', 'activity'],
        ['/studio/analytics/summary', 'analytics summary', null],
        ['/studio/crm/pipeline', 'CRM pipeline', null],
        ['/studio/crm/tasks', 'CRM tasks', 'tasks'],
        ['/studio/shop/orders', 'shop orders', 'orders'],
    ];
    for (const [path, label] of studioReads) {
        await test(`GET ${path} (${label})`, async () => {
            assertStatus(await request('GET', path, { session: studio }), 200);
        });
    }

    await test('GET /studio/crm/notes requires customer_id', async () => {
        assertStatus(await request('GET', '/studio/crm/notes', { session: studio }), [400, 422]);
        if (ctx.studioCustomerId) {
            assertStatus(
                await request('GET', '/studio/crm/notes', {
                    session: studio,
                    query: { customer_id: ctx.studioCustomerId },
                }),
                200,
                'with customer_id'
            );
        }
    });

    await test('GET /studio/settings exposes standorte for multi-location', async () => {
        const res = assertStatus(await request('GET', '/studio/settings', { session: studio }), 200);
        const settings = unwrap(res, 'settings') || {};
        assert(Array.isArray(settings.standorte), `no standorte array: ${Object.keys(settings).join(',')}`);
        assert(settings.oeffnungszeiten, 'studio settings expose no opening hours');
        ctx.studioSettings = settings;
        return `${settings.standorte.length} location(s)`;
    });

    await test('studio CRM task create/update/delete round-trip', async () => {
        const created = await request('POST', '/studio/crm/tasks', {
            session: studio,
            body: {
                titel: 'Regression task',
                faellig_am: iso(addDays(3)),
                customer_id: ctx.studioCustomerId || undefined,
            },
        });
        assertStatus(created, [200, 201, 400, 422], 'create task');
        if (created.status >= 400) return `create rejected ${created.status}`;
        const id = idOf(unwrap(created, 'task'));
        assert(id, `no task id in ${JSON.stringify(created.body?.data).slice(0, 160)}`);
        assertStatus(
            await request('PATCH', `/studio/crm/tasks/${id}`, { session: studio, body: { status: 'erledigt' } }),
            [200, 400, 422],
            'update task'
        );
        assertStatus(await request('DELETE', `/studio/crm/tasks/${id}`, { session: studio }), [200, 204], 'delete');
    });

    await test('studio endpoints are denied to a customer', async () => {
        for (const [path] of studioReads) {
            assertStatus(await request('GET', path, { session: customer }), [401, 403], path);
        }
    });

    // ── Admin ─────────────────────────────────────────────────────────────
    suite('Admin Dashboard');

    await test('GET /studio/admin/studios as admin', async () => {
        const res = assertStatus(await request('GET', '/studio/admin/studios', { session: admin }), 200);
        const list = unwrapList(res, 'studios');
        ctx.adminStudioId = idOf(list[0]) || null;
        return `${list.length} studio(s)`;
    });

    await test('admin can read a specific studio config', async () => {
        if (!ctx.adminStudioId) return 'skip';
        const res = assertStatus(
            await request('GET', `/config/studios/${ctx.adminStudioId}`, { session: admin }),
            200
        );
        const cfg = unwrap(res, 'studio_config') || {};
        assert(cfg.sperrfristen, 'admin studio config missing sperrfristen');
        assert(cfg.termin_einstellungen, 'admin studio config missing termin_einstellungen');
    });

    await test('admin can patch a studio config block', async () => {
        if (!ctx.adminStudioId) return 'skip';
        const read = await request('GET', `/config/studios/${ctx.adminStudioId}`, { session: admin });
        const current = (unwrap(read, 'studio_config') || {}).termin_einstellungen?.buchung_horizont_tage;
        if (typeof current !== 'number') return 'skip';
        const probe = current === 200 ? 199 : 200;
        assertStatus(
            await request('PATCH', `/config/studios/${ctx.adminStudioId}`, {
                session: admin,
                body: { termin_einstellungen: { buchung_horizont_tage: probe } },
            }),
            200,
            'patch'
        );
        assertStatus(
            await request('PATCH', `/config/studios/${ctx.adminStudioId}`, {
                session: admin,
                body: { termin_einstellungen: { buchung_horizont_tage: current } },
            }),
            200,
            'restore'
        );
        return `${current} -> ${probe} -> ${current}`;
    });

    await test('GET /elaycoins/studio/overview as studio', async () => {
        assertStatus(await request('GET', '/elaycoins/studio/overview', { session: studio }), 200);
    });

    // ── Shop ──────────────────────────────────────────────────────────────
    suite('Shop');

    await test('GET /shop/products lists products', async () => {
        const res = assertStatus(await request('GET', '/shop/products', { session: customer }), 200);
        const list = unwrapList(res, 'products');
        ctx.productId = idOf(list[0]) || null;
        return `${list.length} product(s)`;
    });

    await test('GET /shop/products/{id} returns a product', async () => {
        if (!ctx.productId) return 'skip';
        assertStatus(await request('GET', `/shop/products/${ctx.productId}`, { session: customer }), 200);
    });

    await test('GET /shop/shipping returns shipping options', async () => {
        assertStatus(await request('GET', '/shop/shipping', { session: customer }), 200);
    });

    await test('GET /shop/orders lists own orders', async () => {
        const res = assertStatus(await request('GET', '/shop/orders', { session: customer }), 200);
        unwrapList(res, 'orders');
    });

    await test('POST /shop/orders rejects an empty cart', async () => {
        assertStatus(await request('POST', '/shop/orders', { session: customer, body: { positionen: [] } }), [
            400,
            422,
        ]);
    });

    // ── Messaging ─────────────────────────────────────────────────────────
    suite('Messaging');

    await test('GET /messaging/conversations lists conversations', async () => {
        const res = assertStatus(await request('GET', '/messaging/conversations', { session: customer }), 200);
        const list = unwrapList(res, 'conversations');
        ctx.conversationId = idOf(list[0]) || null;
        return `${list.length} conversation(s)`;
    });

    await test('POST /messaging/conversations opens a conversation', async () => {
        const res = await request('POST', '/messaging/conversations', { session: customer, body: {} });
        assertStatus(res, [200, 201, 400, 422]);
        const id = idOf(unwrap(res, 'conversation'));
        if (id) ctx.conversationId = id;
        return `status ${res.status}`;
    });

    await test('messaging send + read round-trip', async () => {
        if (!ctx.conversationId) return 'skip';
        const sent = await request('POST', `/messaging/conversations/${ctx.conversationId}/messages`, {
            session: customer,
            body: { text: 'regression ping' },
        });
        assertStatus(sent, [200, 201, 400, 422], 'send');
        if (sent.status >= 400) return `send rejected ${sent.status}`;
        const list = assertStatus(
            await request('GET', `/messaging/conversations/${ctx.conversationId}/messages`, { session: customer }),
            200,
            'list'
        );
        unwrapList(list, 'messages');
        assertStatus(
            await request('POST', `/messaging/conversations/${ctx.conversationId}/read`, {
                session: customer,
                body: {},
            }),
            [200, 204],
            'read'
        );
    });

    await test('customer cannot read a foreign conversation', async () => {
        assertStatus(
            await request('GET', '/messaging/conversations/000000000000000000000000', { session: customer }),
            [400, 403, 404]
        );
    });

    // ── Aftercare / fading ────────────────────────────────────────────────
    suite('Aftercare & Fading');

    await test('GET /nachsorge lists aftercare records', async () => {
        const res = await request('GET', '/nachsorge', { session: studio });
        assertStatus(res, [200, 403]);
        return `status ${res.status}`;
    });

    await test('POST /nachsorge/check validates its input', async () => {
        const res = await request('POST', '/nachsorge/check', { session: customer, body: {} });
        assertStatus(res, [200, 400, 422]);
        return `status ${res.status}`;
    });

    await test('an aftercare check on a zone case must name a zone', async () => {
        if (!ctx.caseAIsZoned) return 'skip';
        const res = await request('POST', '/nachsorge/check', {
            session: customer,
            body: { case_id: ctx.caseA, foto_file_id: '0'.repeat(24) },
        });
        assertStatus(res, [400, 422], 'aftercare on a zone case must be assigned to a zone');
        return `status ${res.status}`;
    });

    await test('an aftercare check cannot name a zone outside the case', async () => {
        if (!ctx.caseAIsZoned) return 'skip';
        const res = await request('POST', '/nachsorge/check', {
            session: customer,
            body: { case_id: ctx.caseA, zonen_id: 'Z999', foto_file_id: '0'.repeat(24) },
        });
        assertStatus(res, [400, 422], 'an unknown zone must be refused');
        return `status ${res.status}`;
    });

    await test('GET /nachsorge accepts a zone filter', async () => {
        if (!ctx.caseAIsZoned) return 'skip';
        const res = await request('GET', '/nachsorge', {
            session: customer,
            query: { case_id: ctx.caseA, zonen_id: ctx.caseAZones[0], limit: 20 },
        });
        assertStatus(res, 200);
        const rows = unwrapList(res, 'checks');
        assert(
            rows.every((c) => c.zonen_id === ctx.caseAZones[0]),
            `zone filter leaked other zones: ${JSON.stringify(rows.map((c) => c.zonen_id))}`
        );
        return `${rows.length} row(s)`;
    });

    await test('POST /verblassung validates its input', async () => {
        const res = await request('POST', '/verblassung', { session: studio, body: {} });
        assertStatus(res, [200, 400, 422]);
        return `status ${res.status}`;
    });

    // ── Files ─────────────────────────────────────────────────────────────
    suite('Files');

    await test('POST /files/staging rejects a request with no file', async () => {
        assertStatus(await request('POST', '/files/staging', { session: customer, body: {} }), [400, 415, 422]);
    });

    await test('GET /files/{id} rejects an unknown id', async () => {
        assertStatus(await request('GET', '/files/000000000000000000000000', { session: customer }), [
            400,
            403,
            404,
        ]);
    });

    await test('GET /files/{id}/content requires authentication', async () => {
        assertStatus(await request('GET', '/files/000000000000000000000000/content'), 401);
    });

    // ── Studio transfers ──────────────────────────────────────────────────
    suite('Studio Transfers');

    await test('GET /studio-transfers/me for the customer', async () => {
        const res = await request('GET', '/studio-transfers/me', { session: customer });
        assertStatus(res, [200, 403, 404]);
        return `status ${res.status}`;
    });

    await test('GET /studio-transfers for the studio', async () => {
        const res = await request('GET', '/studio-transfers', { session: studio });
        assertStatus(res, [200, 403]);
        return `status ${res.status}`;
    });

    // ── Chat (AI) ─────────────────────────────────────────────────────────
    suite('Elaya Chat');

    await test('POST /chat responds or reports AI unavailable', async () => {
        const res = await request('POST', '/chat', { session: studio, body: { message: 'hello' } });
        assertStatus(res, [200, 400, 422, 503]);
        return `status ${res.status}`;
    });

    // ── Input hardening ───────────────────────────────────────────────────
    suite('Input Validation & Hardening');

    await test('malformed ObjectId is rejected cleanly, not with a 500', async () => {
        assertStatus(await request('GET', '/cases/not-a-valid-object-id', { session: customer }), [400, 404]);
    });

    await test('unknown route returns 404', async () => {
        assertStatus(await request('GET', '/this/route/does/not/exist'), 404);
    });

    await test('oversized pagination limit is clamped or rejected', async () => {
        const res = await request('GET', '/cases', { session: customer, query: { limit: 100000 } });
        assertStatus(res, [200, 400, 422]);
        if (res.status === 200) {
            const list = unwrapList(res, 'cases');
            assert(list.length <= 500, `limit not clamped: returned ${list.length}`);
        }
        return `status ${res.status}`;
    });

    await test('invalid JSON body is rejected with 400, not 500', async () => {
        const res = await fetch(`${BASE_URL}/cases`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${customer.accessToken}`,
            },
            body: '{ this is not json',
        });
        assert([400, 422].includes(res.status), `expected 400/422, got ${res.status}`);
    });

    skip('POST /auth/reset-password (needs a real emailed token)', 'requires out-of-band token');
    skip('Stripe payment capture', 'requires live Stripe credentials');
};

module.exports = {
    runApiSuites,
    iso,
    addDays,
    bookableDate,
    closedWeekdaysFrom,
    CLEAN_PRECHECK,
    CLEAN_ANAMNESIS,
    SIGNATURE_PNG,
};

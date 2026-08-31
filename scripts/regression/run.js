/**
 * Full backend regression run.
 *
 * Creates its own throwaway customer so the journey can be exercised end to end
 * without depending on (or disturbing) seeded accounts, then removes everything
 * it created. Requires the API to be running on REGRESSION_BASE_URL.
 *
 *   node scripts/regression/run.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const { request, login } = require('./httpClient');
const { suite, test, assert, assertStatus, summary } = require('./runner');
const { runApiSuites } = require('./apiSuites');
const { runSocketSuites } = require('./socketSuites');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@elaya.ch';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin1234!';
const STUDIO_EMAIL = process.env.SEED_STUDIO_EMAIL || 'studio@inkfree.ch';
const STUDIO_PASSWORD = process.env.SEED_STUDIO_PASSWORD || 'Studio1234!';
const STUDIO_CODE = process.env.REGRESSION_STUDIO_CODE || 'INKFREE';

const TEST_PASSWORD = 'RegressionTest123!';

const main = async () => {
    const started = Date.now();
    const ctx = {
        createdCases: [],
        createdAppointments: [],
        createdSessions: [],
        createdUserIds: [],
    };

    console.log('\n=== ELAYA BACKEND REGRESSION ===\n');

    // ── Setup ─────────────────────────────────────────────────────────────
    suite('Setup');

    ctx.customerEmail = `regression+${Date.now()}@elaya.test`;

    await test('POST /auth/register/customer creates a fresh test customer', async () => {
        const res = await request('POST', '/auth/register/customer', {
            body: {
                vorname: 'Regression',
                nachname: 'Tester',
                email: ctx.customerEmail,
                telefon: '+41790000000',
                password: TEST_PASSWORD,
                studio_code: STUDIO_CODE,
            },
        });
        assertStatus(res, [200, 201], 'register');
        return ctx.customerEmail;
    });

    await test('all three roles can log in', async () => {
        ctx.admin = await login('admin', ADMIN_EMAIL, ADMIN_PASSWORD);
        ctx.studio = await login('studio', STUDIO_EMAIL, STUDIO_PASSWORD);
        ctx.customer = await login('customer', ctx.customerEmail, TEST_PASSWORD);
        assert(ctx.admin.user.role === 'super_admin', `admin role was ${ctx.admin.user.role}`);
        assert(ctx.studio.user.role === 'studio_admin', `studio role was ${ctx.studio.user.role}`);
        assert(ctx.customer.user.role === 'customer', `customer role was ${ctx.customer.user.role}`);
        ctx.createdUserIds.push(ctx.customer.user.id);
    });

    if (!ctx.admin || !ctx.studio || !ctx.customer) {
        console.error('\nFATAL: could not establish all sessions; aborting.\n');
        return finish(ctx, started, 1);
    }

    // ── Suites ────────────────────────────────────────────────────────────
    try {
        await runApiSuites(ctx);
    } catch (err) {
        console.error('\nAPI suites aborted: ' + err.stack + '\n');
    }

    try {
        await runSocketSuites(ctx);
    } catch (err) {
        console.error('\nSocket suites aborted: ' + err.stack + '\n');
    }

    await cleanup(ctx);
    return finish(ctx, started, 0);
};

/** Removes everything the run created, so repeated runs stay idempotent. */
const cleanup = async (ctx) => {
    suite('Cleanup');

    await test('remove data created by this run', async () => {
        await mongoose.connect(process.env.MONGO_URI);
        const removed = [];

        const models = {
            Appointment: require('../../models/appointmentModel'),
            Session: require('../../models/sessionModel'),
            Case: require('../../models/caseModel'),
            User: require('../../models/userModel'),
            Customer: require('../../models/customerModel'),
        };

        if (ctx.createdAppointments.length) {
            const r = await models.Appointment.deleteMany({ _id: { $in: ctx.createdAppointments.filter(Boolean) } });
            removed.push(`${r.deletedCount} appointment(s)`);
        }
        if (ctx.createdSessions.length) {
            const r = await models.Session.deleteMany({ _id: { $in: ctx.createdSessions.filter(Boolean) } });
            removed.push(`${r.deletedCount} session(s)`);
        }

        const customerId = ctx.customer?.user?.customer_id;
        if (customerId) {
            const r = await models.Case.deleteMany({ customer: customerId });
            removed.push(`${r.deletedCount} case(s)`);
            const c = await models.Customer.deleteMany({ _id: customerId });
            removed.push(`${c.deletedCount} customer profile(s)`);
        }
        if (ctx.customerEmail) {
            const u = await models.User.deleteMany({ email: ctx.customerEmail });
            removed.push(`${u.deletedCount} user(s)`);
        }

        await mongoose.disconnect();
        return removed.join(', ') || 'nothing to remove';
    });
};

const finish = async (ctx, started, code) => {
    const s = summary();
    const durationMs = Date.now() - started;

    console.log('\n=== SUMMARY ===');
    console.log(`  passed:  ${s.pass}`);
    console.log(`  failed:  ${s.fail}`);
    console.log(`  skipped: ${s.skip}`);
    console.log(`  total:   ${s.total}`);
    console.log(`  time:    ${(durationMs / 1000).toFixed(1)}s`);

    if (s.fail > 0) {
        console.log('\n=== FAILURES ===');
        for (const r of s.results.filter((x) => x.status === 'fail')) {
            console.log(`  [${r.suite}] ${r.name}\n      ${r.detail}`);
        }
    }

    const fs = require('fs');
    const path = require('path');
    const out = path.join(__dirname, 'results.json');
    fs.writeFileSync(
        out,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                durationMs,
                summary: { pass: s.pass, fail: s.fail, skip: s.skip, total: s.total },
                results: s.results,
            },
            null,
            2
        )
    );
    console.log(`\nresults written to ${out}\n`);

    process.exit(code || (s.fail > 0 ? 1 : 0));
};

main().catch(async (err) => {
    console.error('\nFATAL: ' + err.stack + '\n');
    try {
        await mongoose.disconnect();
    } catch {
        /* already closed */
    }
    process.exit(1);
});

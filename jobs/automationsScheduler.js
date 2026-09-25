/**
 * Background Automations scheduler.
 * Evaluates all active rules for customers even when the app is closed,
 * then delivers via in-app inbox + Expo push.
 *
 * Env:
 *   AUTOMATIONS_SCHEDULER=false  — disable
 *   AUTOMATIONS_INTERVAL_MS      — default 900000 (15 min)
 *   AUTOMATIONS_BATCH_LIMIT      — customers per tick (default 200)
 */

const { runAutomationsBatch } = require('../utils/automationsEngine');

let timer = null;
let running = false;

const startAutomationsScheduler = () => {
    if (String(process.env.AUTOMATIONS_SCHEDULER || 'true').toLowerCase() === 'false') {
        console.log('Automations scheduler disabled (AUTOMATIONS_SCHEDULER=false)');
        return;
    }

    const interval = Math.max(
        60_000,
        Number(process.env.AUTOMATIONS_INTERVAL_MS) || 15 * 60 * 1000
    );
    const limit = Math.max(1, Number(process.env.AUTOMATIONS_BATCH_LIMIT) || 200);

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            let skip = 0;
            let totalChecked = 0;
            let totalFired = 0;
            // Walk all customers in pages within one tick (cap pages to avoid overload)
            for (let page = 0; page < 50; page += 1) {
                const result = await runAutomationsBatch({ limit, skip });
                totalChecked += result.checked;
                totalFired += result.fired;
                if (result.batch_size < limit) break;
                skip += limit;
            }
            if (totalFired > 0 || process.env.AUTOMATIONS_LOG_EMPTY === 'true') {
                console.log(
                    `[automations] tick checked=${totalChecked} fired=${totalFired}`
                );
            }
        } catch (err) {
            console.error('[automations] scheduler tick failed:', err.message);
        } finally {
            running = false;
        }
    };

    // First run shortly after boot (give DB / sockets a moment)
    const warmup = setTimeout(() => {
        void tick();
    }, 20_000);
    if (typeof warmup.unref === 'function') warmup.unref();

    timer = setInterval(() => {
        void tick();
    }, interval);
    if (typeof timer.unref === 'function') timer.unref();

    console.log(
        `Automations scheduler started (every ${Math.round(interval / 60000)} min, batch ${limit})`
    );
};

const stopAutomationsScheduler = () => {
    if (timer) clearInterval(timer);
    timer = null;
};

module.exports = {
    startAutomationsScheduler,
    stopAutomationsScheduler,
};

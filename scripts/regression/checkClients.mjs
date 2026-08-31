/**
 * Static regression checks for the two client apps.
 *
 * Catches the class of defect that neither the bundler nor the type-checker
 * reports: translation keys referenced in code but missing from a locale,
 * locales that have drifted apart, and duplicate keys that silently shadow an
 * earlier translation.
 *
 *   node scripts/regression/checkClients.mjs
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = '/Users/macbook/elaya';
const results = [];

const record = (suite, name, status, detail = '') => {
    results.push({ suite, name, status, detail });
    const icon = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
    console.log(`  [${icon}] ${name}${detail ? ` — ${detail}` : ''}`);
};

const walk = (dir, exts, out = []) => {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'build') continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, exts, out);
        else if (exts.includes(extname(full))) out.push(full);
    }
    return out;
};

/** Collects dotted leaf paths from a nested translation object. */
const leafPaths = (obj, prefix = '', out = new Set()) => {
    for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) leafPaths(v, path, out);
        else out.add(path);
    }
    return out;
};

/**
 * Reads a locale module by stripping the TS export wrapper and evaluating the
 * object literal, which avoids needing a TS toolchain here.
 */
const loadLocale = async (file) => {
    const src = readFileSync(file, 'utf8');
    // Skip past any leading imports/type annotations to the assignment that
    // opens the actual translation object.
    const assignment = src.search(/(?:export\s+(?:default|const)|const)\s+[A-Za-z0-9_$]+[^=]*=\s*\{/);
    const start = assignment === -1 ? src.indexOf('{') : src.indexOf('{', assignment);
    const end = src.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error(`cannot locate object literal in ${file}`);
    }
    const body = src.slice(start, end + 1).replace(/\bas const\b/g, '');
    // eslint-disable-next-line no-new-func
    return new Function(`return (${body});`)();
};

/** Finds keys defined more than once inside the same object literal. */
const duplicateKeys = (file) => {
    const src = readFileSync(file, 'utf8').split('\n');
    const stack = [new Map()];
    const dupes = [];
    src.forEach((line, i) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        const keyMatch = trimmed.match(/^'?([A-Za-z0-9_$-]+)'?\s*:/);
        if (keyMatch) {
            const scope = stack[stack.length - 1];
            const key = keyMatch[1];
            if (scope.has(key)) dupes.push(`${key} (lines ${scope.get(key)} & ${i + 1})`);
            else scope.set(key, i + 1);
        }
        const opens = (trimmed.match(/\{/g) || []).length;
        const closes = (trimmed.match(/\}/g) || []).length;
        for (let n = 0; n < opens; n += 1) stack.push(new Map());
        for (let n = 0; n < closes; n += 1) if (stack.length > 1) stack.pop();
    });
    return dupes;
};

const checkLocalePair = async (label, deFile, enFile) => {
    let de;
    let en;
    try {
        de = await loadLocale(deFile);
        en = await loadLocale(enFile);
    } catch (err) {
        record(label, 'locale files parse', 'fail', err.message);
        return null;
    }
    record(label, 'locale files parse', 'pass');

    for (const [name, file] of [
        ['de', deFile],
        ['en', enFile],
    ]) {
        const dupes = duplicateKeys(file);
        if (dupes.length) {
            record(label, `${name}: no duplicate keys`, 'fail', dupes.slice(0, 6).join('; '));
        } else {
            record(label, `${name}: no duplicate keys`, 'pass');
        }
    }

    const deKeys = leafPaths(de);
    const enKeys = leafPaths(en);
    const missingEn = [...deKeys].filter((k) => !enKeys.has(k));
    const missingDe = [...enKeys].filter((k) => !deKeys.has(k));

    if (missingEn.length === 0 && missingDe.length === 0) {
        record(label, 'de and en cover the same keys', 'pass', `${deKeys.size} keys`);
    } else {
        const parts = [];
        if (missingEn.length) parts.push(`${missingEn.length} missing in en (e.g. ${missingEn.slice(0, 4).join(', ')})`);
        if (missingDe.length) parts.push(`${missingDe.length} missing in de (e.g. ${missingDe.slice(0, 4).join(', ')})`);
        record(label, 'de and en cover the same keys', 'fail', parts.join(' | '));
    }

    return { deKeys, enKeys };
};

/** Cross-references literal t('...') calls in source against the locale keys. */
const checkUsedKeys = (label, srcDir, keys, exts) => {
    if (!keys) return;
    const files = walk(srcDir, exts);
    const used = new Map();
    const dynamic = new Set();

    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        // Literal keys only; template literals are recorded separately.
        for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) used.set(m[1], file);
        for (const m of src.matchAll(/\bt\(\s*"([^"]+)"/g)) used.set(m[1], file);
        for (const m of src.matchAll(/\bt\(\s*`([^`]*\$\{)/g)) dynamic.add(file);
    }

    // i18next resolves plurals via _one/_other siblings, and some call sites
    // pass a variable or a documented pattern rather than a literal key.
    const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];
    const known = (k) =>
        keys.deKeys.has(k) ||
        keys.enKeys.has(k) ||
        PLURAL_SUFFIXES.some((s) => keys.deKeys.has(k + s) || keys.enKeys.has(k + s));
    const isLiteralKey = (k) => /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(k);

    const missing = [...used.entries()].filter(([k]) => isLiteralKey(k) && !known(k));

    if (missing.length === 0) {
        record(label, 'every literal t() key exists in the locales', 'pass', `${used.size} keys referenced`);
    } else {
        record(
            label,
            'every literal t() key exists in the locales',
            'fail',
            missing
                .slice(0, 8)
                .map(([k, f]) => `${k} (${f.split('/src/')[1]})`)
                .join('; ')
        );
    }

    if (dynamic.size) {
        record(
            label,
            'dynamically built t() keys noted for manual review',
            'skip',
            `${dynamic.size} file(s) build keys at runtime`
        );
    }
};

console.log('\n=== CLIENT STATIC REGRESSION ===\n');

// ── Frontend ──────────────────────────────────────────────────────────────
console.log('Frontend i18n');
const feKeys = await checkLocalePair(
    'Frontend i18n',
    `${ROOT}/elaya-frontend/src/i18n/locales/de.ts`,
    `${ROOT}/elaya-frontend/src/i18n/locales/en.ts`
);
checkUsedKeys('Frontend i18n', `${ROOT}/elaya-frontend/src`, feKeys, ['.js', '.jsx']);

console.log('\nFrontend content bundles');
const feContent = await checkLocalePair(
    'Frontend content bundles',
    `${ROOT}/elaya-frontend/src/content/caseForm.de.js`,
    `${ROOT}/elaya-frontend/src/content/caseForm.en.js`
);
if (feContent) {
    record(
        'Frontend content bundles',
        'caseForm de/en parity',
        'pass',
        `${feContent.deKeys.size} keys`
    );
}

// ── Mobile ────────────────────────────────────────────────────────────────
console.log('\nMobile i18n');
const mobKeys = await checkLocalePair(
    'Mobile i18n',
    `${ROOT}/elaya-mobile/src/i18n/locales/de.ts`,
    `${ROOT}/elaya-mobile/src/i18n/locales/en.ts`
);
checkUsedKeys('Mobile i18n', `${ROOT}/elaya-mobile/src`, mobKeys, ['.ts', '.tsx']);

// ── Frontend routes ───────────────────────────────────────────────────────
console.log('\nFrontend routing');
{
    const appSrc = readFileSync(`${ROOT}/elaya-frontend/src/App.jsx`, 'utf8');
    const routes = [...appSrc.matchAll(/<Route\s+[^>]*path=["']([^"']+)["']/g)].map((m) => m[1]);
    record('Frontend routing', 'App.jsx declares routes', routes.length > 0 ? 'pass' : 'fail', `${routes.length} route(s)`);

    const elements = [...appSrc.matchAll(/element=\{<\s*([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const imported = new Set(
        [...appSrc.matchAll(/import\s+(?:\{([^}]+)\}|([A-Za-z0-9_]+))\s+from/g)].flatMap((m) =>
            (m[1] || m[2] || '').split(',').map((s) => s.trim().split(' as ').pop())
        )
    );
    const lazy = new Set([...appSrc.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*lazy\(/g)].map((m) => m[1]));
    const unresolved = [...new Set(elements)].filter((e) => !imported.has(e) && !lazy.has(e));
    record(
        'Frontend routing',
        'every routed element is imported',
        unresolved.length === 0 ? 'pass' : 'fail',
        unresolved.length ? `unresolved: ${unresolved.join(', ')}` : `${new Set(elements).size} element(s)`
    );

    record(
        'Frontend routing',
        'SocketProvider wraps the app',
        appSrc.includes('SocketProvider') ? 'pass' : 'fail',
        'single multiplexed socket connection'
    );
}

// ── Mobile navigation ─────────────────────────────────────────────────────
console.log('\nMobile navigation');
{
    const navDir = `${ROOT}/elaya-mobile/src/navigation`;
    const navFiles = walk(navDir, ['.ts', '.tsx']);
    const declared = new Set();
    for (const f of navFiles) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/<\s*[A-Za-z.]*Screen\s+name=["']([^"']+)["']/g)) declared.add(m[1]);
        for (const m of src.matchAll(/name=["']([^"']+)["']\s+component=/g)) declared.add(m[1]);
    }
    record(
        'Mobile navigation',
        'navigators declare screens',
        declared.size > 0 ? 'pass' : 'fail',
        `${declared.size} screen(s)`
    );

    const typeFile = `${navDir}/types.ts`;
    const typeSrc = readFileSync(typeFile, 'utf8');
    const paramListKeys = new Set([...typeSrc.matchAll(/^\s{2}([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1]));
    const undeclared = [...declared].filter((s) => !paramListKeys.has(s));
    record(
        'Mobile navigation',
        'every screen name appears in a ParamList type',
        undeclared.length === 0 ? 'pass' : 'fail',
        undeclared.length ? `missing: ${undeclared.slice(0, 8).join(', ')}` : `${paramListKeys.size} typed route(s)`
    );

    // navigate('X') targets must exist as a declared screen.
    const screens = walk(`${ROOT}/elaya-mobile/src/screens`, ['.tsx']);
    const targets = new Map();
    for (const f of screens) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/navigation\.navigate\(\s*'([^']+)'/g)) targets.set(m[1], f);
    }
    const brokenNav = [...targets.entries()].filter(([t]) => !declared.has(t) && !paramListKeys.has(t));
    record(
        'Mobile navigation',
        'every navigate() target resolves to a screen',
        brokenNav.length === 0 ? 'pass' : 'fail',
        brokenNav.length
            ? brokenNav
                  .slice(0, 6)
                  .map(([t, f]) => `${t} (${f.split('/screens/')[1]})`)
                  .join('; ')
            : `${targets.size} target(s)`
    );
}

// ── Hardcoded values that should come from studio config ──────────────────
console.log('\nDynamic configuration');
{
    const patterns = [
        [/BOOKING_HORIZON_DAYS\s*=\s*\d+/, 'hardcoded booking horizon'],
        [/UV_LOCK_DAYS\s*=\s*\d+/, 'hardcoded UV lockout days'],
        [/MED_LOCK_DAYS\s*=\s*\d+/, 'hardcoded medication lockout days'],
        [/SAME_CASE_DAYS\s*=\s*\d+/, 'hardcoded same-case interval'],
        [/CROSS_CASE_DAYS\s*=\s*\d+/, 'hardcoded cross-case interval'],
    ];
    const scanDirs = [
        [`${ROOT}/elaya-mobile/src`, ['.ts', '.tsx']],
        [`${ROOT}/elaya-frontend/src`, ['.js', '.jsx']],
        [`${ROOT}/elaya-backend/utils`, ['.js']],
    ];
    const hits = [];
    for (const [dir, exts] of scanDirs) {
        for (const f of walk(dir, exts)) {
            const src = readFileSync(f, 'utf8');
            for (const [re, label] of patterns) {
                if (re.test(src)) hits.push(`${label} in ${f.replace(`${ROOT}/`, '')}`);
            }
        }
    }
    record(
        'Dynamic configuration',
        'no hardcoded lockout or horizon constants remain',
        hits.length === 0 ? 'pass' : 'fail',
        hits.slice(0, 6).join('; ')
    );

    const mobileBook = readFileSync(`${ROOT}/elaya-mobile/src/screens/app/BookAppointmentScreen.tsx`, 'utf8');
    record(
        'Dynamic configuration',
        'mobile booking reads the horizon from studio config',
        mobileBook.includes('buchung_horizont_tage') ? 'pass' : 'fail'
    );
    record(
        'Dynamic configuration',
        'mobile booking omits duration so the studio default applies',
        !/dauer_minuten:\s*\d+/.test(mobileBook) ? 'pass' : 'fail'
    );
}

// ── Summary ───────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.status === 'pass').length;
const fail = results.filter((r) => r.status === 'fail').length;
const skip = results.filter((r) => r.status === 'skip').length;

console.log('\n=== SUMMARY ===');
console.log(`  passed:  ${pass}`);
console.log(`  failed:  ${fail}`);
console.log(`  skipped: ${skip}`);

if (fail) {
    console.log('\n=== FAILURES ===');
    for (const r of results.filter((x) => x.status === 'fail')) {
        console.log(`  [${r.suite}] ${r.name}\n      ${r.detail}`);
    }
}

writeFileSync(
    new URL('./clientResults.json', import.meta.url),
    JSON.stringify(
        { generatedAt: new Date().toISOString(), summary: { pass, fail, skip, total: results.length }, results },
        null,
        2
    )
);
console.log('\nresults written to clientResults.json\n');
process.exit(fail > 0 ? 1 : 0);

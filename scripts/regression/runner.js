/**
 * Tiny assertion + reporting runner for the regression harness.
 *
 * Results are collected as structured records so the same run can print a
 * console summary and feed the PDF report without a second execution.
 */

const results = [];
let currentSuite = 'ungrouped';

const suite = (name) => {
    currentSuite = name;
};

const record = (name, status, detail) => {
    results.push({ suite: currentSuite, name, status, detail: detail ?? '' });
    const icon = status === 'pass' ? 'PASS' : status === 'skip' ? 'SKIP' : 'FAIL';
    const line = `  [${icon}] ${name}${detail ? ` — ${detail}` : ''}`;
    console.log(line);
};

/** Runs an async check; any throw is recorded as a failure rather than aborting the run. */
const test = async (name, fn) => {
    try {
        const outcome = await fn();
        if (outcome === 'skip') record(name, 'skip');
        else record(name, 'pass', typeof outcome === 'string' ? outcome : '');
    } catch (err) {
        record(name, 'fail', err.message);
    }
};

const skip = (name, why) => record(name, 'skip', why);

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const assertStatus = (res, expected, label = '') => {
    const list = Array.isArray(expected) ? expected : [expected];
    if (!list.includes(res.status)) {
        const detail = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
        throw new Error(
            `${label || 'request'} expected ${list.join('/')}, got ${res.status}: ${String(detail).slice(0, 240)}`
        );
    }
    return res;
};

const assertEqual = (actual, expected, label) => {
    if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
};

/**
 * Pulls a value out of the API's `{ success, data: { <key>: ... } }` envelope.
 * Falls back to `data` itself so endpoints that return it bare still work.
 */
const unwrap = (res, key) => {
    const data = res?.body?.data;
    if (data == null) throw new Error('response has no data envelope');
    if (!key) return data;
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
        // Strict on purpose: silently falling back to `data` used to turn
        // envelope mismatches into false-positive passes.
        throw new Error(`response envelope has no "${key}"; keys are [${Object.keys(data).join(', ')}]`);
    }
    return data[key];
};

/** Unwraps a paginated collection, asserting it really is a list. */
const unwrapList = (res, key) => {
    const value = unwrap(res, key);
    if (!Array.isArray(value)) {
        throw new Error(`expected ${key} to be an array, got ${JSON.stringify(value)?.slice(0, 160)}`);
    }
    return value;
};

const idOf = (doc) => (doc ? String(doc.id ?? doc._id ?? '') : '');

const summary = () => {
    const pass = results.filter((r) => r.status === 'pass').length;
    const fail = results.filter((r) => r.status === 'fail').length;
    const skipped = results.filter((r) => r.status === 'skip').length;
    return { pass, fail, skip: skipped, total: results.length, results };
};

module.exports = {
    suite,
    test,
    skip,
    assert,
    assertStatus,
    assertEqual,
    unwrap,
    unwrapList,
    idOf,
    summary,
    results,
};

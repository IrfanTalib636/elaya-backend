const crypto = require('crypto');

const MIN_LEN = 4;
const MAX_LEN = 10;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Letters only, uppercase, German umlauts expanded. */
const toLetters = (value = '') =>
    String(value)
        .toUpperCase()
        .replace(/Ä/g, 'AE')
        .replace(/Ö/g, 'OE')
        .replace(/Ü/g, 'UE')
        .replace(/ß/g, 'SS')
        .replace(/[^A-Z]/g, '');

/**
 * Valid studio codes: 4–10 chars, A–Z only, at most one hyphen (not at ends).
 * Examples: INKFREE, INK-AESCH, ELAYA
 */
const isValidStudioCode = (code) => {
    if (typeof code !== 'string') return false;
    const normalized = code.trim().toUpperCase();
    if (normalized.length < MIN_LEN || normalized.length > MAX_LEN) return false;
    if ((normalized.match(/-/g) || []).length > 1) return false;
    if (normalized.startsWith('-') || normalized.endsWith('-')) return false;
    return /^[A-Z]+(-[A-Z]+)?$/.test(normalized);
};

const normalizeStudioCode = (code = '') => String(code).trim().toUpperCase();

const randomLetters = (length) => {
    let out = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i += 1) {
        out += LETTERS[bytes[i] % LETTERS.length];
    }
    return out;
};

/**
 * Build readable candidates from firma + ort (e.g. Ink-Free + Aesch → INK-AESCH).
 */
const buildStudioCodeCandidates = ({ firma, ort } = {}) => {
    const firm = toLetters(firma);
    const city = toLetters(ort);
    const candidates = [];
    const push = (code) => {
        const normalized = normalizeStudioCode(code);
        if (isValidStudioCode(normalized) && !candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    if (firm.length >= 2 && city.length >= 2) {
        // Prefer readable lengths first (e.g. INK-AESCH before INKF-AESCH / IN-AE)
        const leftOrder = [3, 4, 2].filter((n) => n <= firm.length);
        const rightOrder = [5, 4, 3, 2].filter((n) => n <= city.length);
        for (const left of leftOrder) {
            for (const right of rightOrder) {
                if (left + 1 + right > MAX_LEN) continue;
                if (left + 1 + right < MIN_LEN) continue;
                push(`${firm.slice(0, left)}-${city.slice(0, right)}`);
            }
        }
    }

    if (firm.length >= MIN_LEN) {
        for (let len = Math.min(MAX_LEN, firm.length); len >= MIN_LEN; len -= 1) {
            push(firm.slice(0, len));
        }
    }

    // Short firma: pad with city letters without hyphen if needed
    if (firm.length > 0 && firm.length < MIN_LEN && city.length > 0) {
        push(`${firm}${city}`.slice(0, MAX_LEN));
    }

    // Random fallbacks (with and without hyphen)
    for (let i = 0; i < 8; i += 1) {
        push(randomLetters(6));
        push(`${randomLetters(3)}-${randomLetters(4)}`);
        push(randomLetters(8));
    }

    return candidates;
};

/**
 * Allocate a unique studio code. `existsFn(code)` should resolve true if taken.
 */
const allocateUniqueStudioCode = async ({ firma, ort, existsFn }) => {
    const candidates = buildStudioCodeCandidates({ firma, ort });

    for (const code of candidates) {
        // eslint-disable-next-line no-await-in-loop
        if (!(await existsFn(code))) return code;
    }

    // Last resort: random until free (bounded)
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const code =
            attempt % 2 === 0
                ? `${randomLetters(3)}-${randomLetters(4)}`
                : randomLetters(6 + (attempt % 3));
        if (!isValidStudioCode(code)) continue;
        // eslint-disable-next-line no-await-in-loop
        if (!(await existsFn(code))) return code;
    }

    throw new Error('Unable to allocate a unique studio code');
};

module.exports = {
    MIN_LEN,
    MAX_LEN,
    isValidStudioCode,
    normalizeStudioCode,
    buildStudioCodeCandidates,
    allocateUniqueStudioCode,
};

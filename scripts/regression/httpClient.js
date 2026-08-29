/**
 * Minimal HTTP client for the regression harness.
 *
 * Keeps a per-session cookie jar so refresh-token flows can be exercised the
 * same way a browser would, and never throws on non-2xx: the suites assert on
 * status codes themselves.
 */

// PORT is accepted so a run can target a throwaway server without having to
// restate the whole URL — silently hitting a stale dev server on the default
// port produces failures that look like real regressions.
const DEFAULT_PORT = process.env.PORT || '4000';
const BASE_URL =
    process.env.REGRESSION_BASE_URL || `http://localhost:${DEFAULT_PORT}/api/v1`;

class Session {
    constructor(label) {
        this.label = label;
        this.accessToken = null;
        this.cookies = new Map();
        this.user = null;
    }

    cookieHeader() {
        if (this.cookies.size === 0) return null;
        return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    absorbCookies(response) {
        const raw = response.headers.getSetCookie?.() ?? [];
        for (const line of raw) {
            const [pair] = line.split(';');
            const idx = pair.indexOf('=');
            if (idx === -1) continue;
            this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
        }
    }
}

/**
 * @param {Session|null} session
 * @returns {Promise<{status:number, body:any, headers:Headers, ok:boolean}>}
 */
const request = async (method, path, { session = null, body, query, headers = {}, raw = false } = {}) => {
    let url = `${BASE_URL}${path}`;
    if (query && Object.keys(query).length > 0) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null) qs.set(k, String(v));
        }
        url += `?${qs.toString()}`;
    }

    const finalHeaders = { ...headers };
    if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
    if (session?.accessToken) finalHeaders.Authorization = `Bearer ${session.accessToken}`;
    const cookie = session?.cookieHeader();
    if (cookie) finalHeaders.Cookie = cookie;

    const response = await fetch(url, {
        method,
        headers: finalHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (session) session.absorbCookies(response);

    let parsed = null;
    if (raw) {
        parsed = Buffer.from(await response.arrayBuffer());
    } else {
        const text = await response.text();
        try {
            parsed = text ? JSON.parse(text) : null;
        } catch {
            parsed = text;
        }
    }

    return { status: response.status, body: parsed, headers: response.headers, ok: response.ok };
};

const login = async (label, email, password) => {
    const session = new Session(label);
    const res = await request('POST', '/auth/login', { session, body: { email, password } });
    if (res.status !== 200 || !res.body?.data?.accessToken) {
        throw new Error(
            `login failed for ${label} (${email}): ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`
        );
    }
    session.accessToken = res.body.data.accessToken;
    session.user = res.body.data.user;
    return session;
};

module.exports = { BASE_URL, Session, request, login };

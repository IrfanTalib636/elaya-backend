# Elaya Backend API

Shared REST API for the Elaya platform — Customer Web Portal, Studio Web Dashboard, Admin Dashboard, and future mobile apps.

**Stack:** Node.js · Express 5 · MongoDB · Mongoose · JWT · Zod  
**API base path:** `/api/v1`  
**Planned production host:** [Railway](https://railway.app)  
**Last updated:** 2026-06-27

---

## Current progress

### Milestone 1 — Backend foundation (complete)

| Area | Status | Notes |
|---|---|---|
| **Week 1 — Foundation & auth** | ✅ **100%** | Complete |
| Project setup + security middleware | ✅ Done | Helmet, CORS, compression, rate limit, mongo-sanitize, HPP |
| MongoDB connection | ✅ Done | Mongoose via `config/db.js` |
| Swagger / OpenAPI docs | ✅ Done | `/api/v1/docs` · `/api/v1/docs.json` |
| Auth — register customer | ✅ Done | German field names per client spec |
| Auth — register studio | ✅ Done | Status `ausstehend` until admin approval |
| Auth — login / refresh / logout | ✅ Done | JWT access token + HttpOnly refresh cookie |
| Auth — `GET /auth/me` | ✅ Done | Protected route |
| Zod validation | ✅ Done | `validators/*.js` + Express 5 query fix |
| Dev seed (super admin + pilot studio) | ✅ Done | `npm run seed:dev` — local only |
| Production admin bootstrap | ✅ Done | `npm run bootstrap:admin` — one-time, guarded |
| User / Customer / Studio models | ✅ Done | |
| **Week 2 — Cases, booking, engines** | ✅ **100%** | Complete |
| Case / CaseZone / Anamnesis models | ✅ Done | Normalized per client §2 mapping |
| Appointment / Session models | ✅ Done | Normalized per client §2 mapping |
| Case CRUD API | ✅ Done | POST/GET/PATCH `/cases` — tested in Swagger |
| Case availability API | ✅ Done | GET `/cases/:id/availability` — calendar + lockout preview |
| Appointment API | ✅ Done | POST/GET/PATCH `/appointments` — group booking supported |
| Session API | ✅ Done | POST/GET/PATCH `/sessions` — studio/admin write, customer read |
| Lockout engine | ✅ Done | `berechneAlleSperren` — 49/28-day, UV/meds, customer booking validation |
| Pricing engine | ✅ Done | 7-factor formula — GET `/cases/:id/pricing` (role-scoped) |
| Elaycoin engine | ✅ Done | Tested — rewards, milestones, no-show, kurzfristige stornierung, expiry |
| **Week 2.5** | ✅ **100%** | |
| Feature flags / platform config | ✅ Done | Tested — admin, customer, studio; `platform_config` + `studio_pricing` / `elaycoin_studio_cfg` |

### Post-M1 polish

| Area | Status | Notes |
|---|---|---|
| List pagination | ✅ Done | `page` + `limit` on GET `/cases`, `/appointments`, `/sessions` |

**Known gaps (non-blocking polish):** Anamnesis CRUD API, zone-level lockout, persist `uvBlockDate`/`medicationBlockDate` on booking, `pruefeSperrfristReaktivierung`.

### Changelog

```
[2026-06-24] — Initial backend README
[2026-06-24] — Auth system (customer/studio register, login, refresh, logout, me)
[2026-06-24] — Swagger docs, Zod validation, security middleware
[2026-06-24] — Dev seed script (super admin + inkFree studio INKFREE)
[2026-06-24] — Production admin bootstrap script (one-time, guarded)
[2026-06-25] — Case, CaseZone, Appointment, Session, Anamnesis models (client §2 mapping)
[2026-06-25] — Case CRUD API with caseId generation and role-based field visibility
[2026-06-25] — Appointment API (book, list, update/cancel, group booking, activityLog)
[2026-06-25] — Session API with case stats sync (aggregation) and role-based field visibility
[2026-06-25] — Case availability endpoint (stub) + Express 5 query validation fix
[2026-06-25] — Full lockout engine (berechneAlleSperren) + customer booking/reschedule validation
[2026-06-25] — Pricing engine (7-factor formula) + GET /cases/:id/pricing
[2026-06-25] — Elaycoin engine (rewards, malus, expiry) + GET /elaycoins/me + session/appointment hooks
[2026-06-26] — Elaycoin locally verified (milestone, no-show, kurzfristige stornierung); customerId vs userId API hints
[2026-06-27] — Platform config + per-studio toggles (feature flags) — GET/PATCH /config/*; studio admin seed; Swagger fixes
[2026-06-27] — Pagination on GET /cases, /appointments, /sessions (page, limit, pagination meta)
[2026-06-27] — Swagger role labels on every endpoint (Auth + Who can call)
```

---

## Project structure

```
backend/
├── config/
│   ├── constants.js       # Enums (roles, case status, appointment status, etc.)
│   ├── db.js              # MongoDB connection
│   ├── fieldReference.js  # Developer cheat sheet (local only, gitignored)
│   ├── pricingDefaults.js # 7-factor pricing multipliers (client §5d)
│   ├── elaycoinConfig.js  # Elaycoin situations + platform limits (client §7)
│   ├── platformDefaults.js # Platform config defaults (elaya_admin_config → platform_config)
│   └── swagger.js         # OpenAPI / Swagger UI setup
├── controllers/
│   ├── authController.js
│   ├── appointmentController.js
│   ├── caseController.js
│   ├── configController.js
│   ├── elaycoinController.js
│   └── sessionController.js
├── middleware/
│   ├── authMiddleware.js      # protect, authorize
│   ├── authRateLimiter.js
│   ├── errorMiddleware.js
│   └── validateMiddleware.js  # Zod validation wrapper
├── models/
│   ├── anamnesisModel.js
│   ├── appointmentModel.js
│   ├── caseModel.js
│   ├── caseZoneModel.js
│   ├── customerModel.js
│   ├── platformConfigModel.js
│   ├── refreshTokenModel.js
│   ├── sessionModel.js
│   ├── studioModel.js
│   └── userModel.js
├── routes/
│   ├── appointmentRoute.js
│   ├── authRoute.js
│   ├── caseRoute.js
│   ├── configRoute.js
│   ├── elaycoinRoute.js
│   ├── healthRoute.js
│   ├── sessionRoute.js
│   └── index.js
├── scripts/
│   ├── bootstrapAdmin.js  # One-time production super admin (guarded)
│   └── seedDev.js         # Local dev fixtures only — blocked in production
├── validators/
│   ├── appointmentValidator.js
│   ├── authValidator.js
│   ├── caseValidator.js
│   ├── configValidator.js
│   ├── paginationValidator.js
│   └── sessionValidator.js
├── utils/
│   ├── accessHelpers.js         # Shared role + access checks
│   ├── ApiError.js
│   ├── asyncHandler.js
│   ├── generateCaseId.js
│   ├── generateTokenAndSetCookies.js
│   ├── lockoutEngine.js         # berechneAlleSperren — 49/28-day, UV/meds
│   ├── pagination.js            # page/limit parsing for list endpoints
│   ├── elaycoinEngine.js        # vergebeElaycoins, zieheElaycoinsAb, expiry
│   ├── configService.js         # platform_config + studio_pricing helpers
│   ├── pricingEngine.js         # 7-factor session price (internal)
│   └── sessionHelpers.js        # session_number + case stats sync
├── server.js
├── .env.example
└── README.md
```

---

## Getting started (local)

### Prerequisites

- Node.js 18+
- MongoDB running locally (or MongoDB Atlas URI)

### Install & run

```bash
cd backend
npm install
cp .env.example .env        # then edit .env
npm run seed:dev            # first time only — creates admin + pilot studio
npm run dev                 # development with nodemon
```

Server: `http://localhost:4000`  
Swagger: `http://localhost:4000/api/v1/docs`

### Environment variables

Copy `.env.example` to `.env`:

| Variable | Description |
|---|---|
| `PORT` | Server port (default `4000`) |
| `NODE_ENV` | `development` or `production` |
| `MONGO_URI` | MongoDB connection string |
| `JWT_ACCESS_SECRET` | Secret for access tokens — use long random string in production |
| `JWT_REFRESH_SECRET` | Secret for refresh tokens — different from access secret |
| `JWT_ACCESS_EXPIRES_IN` | Default `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Default `7d` |
| `CORS_ORIGINS` | Comma-separated frontend URLs |
| `ENABLE_SWAGGER` | `true` to expose `/api/v1/docs` in production |

Optional (local dev seed only — `npm run seed:dev`):

| Variable | Description |
|---|---|
| `SEED_ADMIN_EMAIL` | Dev super admin email (default `admin@elaya.ch`) |
| `SEED_ADMIN_PASSWORD` | Dev super admin password (default `Admin1234!`) |
| `SEED_STUDIO_EMAIL` | Dev studio admin email (default `studio@inkfree.ch`) |
| `SEED_STUDIO_PASSWORD` | Dev studio admin password (default `Studio1234!`) |

Production bootstrap (one-time — `npm run bootstrap:admin`):

| Variable | Description |
|---|---|
| `BOOTSTRAP_ADMIN_ENABLED` | Must be `true` to confirm intentional run |
| `BOOTSTRAP_ADMIN_EMAIL` | First super admin email |
| `BOOTSTRAP_ADMIN_PASSWORD` | Min 12 characters — remove from env after bootstrap |

---

## API endpoints (current)

### Health

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/v1/health` | No |

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/register/customer` | No | Customer signup with `studio_code` |
| `POST` | `/api/v1/auth/register/studio` | No | Studio application — pending admin approval |
| `POST` | `/api/v1/auth/login` | No | Returns access token; sets refresh cookie |
| `POST` | `/api/v1/auth/refresh` | Cookie | New access token |
| `POST` | `/api/v1/auth/logout` | Cookie | Revokes refresh token |
| `GET` | `/api/v1/auth/me` | Bearer | Current user + linked profile |

### Cases

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/cases` | Bearer | Create case — auto `caseId` (#XXX-001) |
| `GET` | `/api/v1/cases` | Bearer | List cases (scoped by role) — **paginated** |
| `GET` | `/api/v1/cases/:id` | Bearer | Get case + zones |
| `PATCH` | `/api/v1/cases/:id` | Bearer | Update case (intake vs studio fields by role) |
| `GET` | `/api/v1/cases/:id/availability` | Bearer | Booking calendar — blocked days + `fruehestes` |
| `GET` | `/api/v1/cases/:id/pricing` | Bearer | Price estimate — customer AB only; studio sees breakdown |

### Appointments

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/appointments` | Bearer | Book appointment for a case |
| `GET` | `/api/v1/appointments` | Bearer | List appointments (scoped by role) — **paginated** |
| `GET` | `/api/v1/appointments/:id` | Bearer | Get appointment details |
| `PATCH` | `/api/v1/appointments/:id` | Bearer | Reschedule or cancel (`status: storniert`) |

### Sessions

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/sessions` | Bearer (studio/admin) | Record treatment session |
| `GET` | `/api/v1/sessions` | Bearer | List sessions (customer = read-only view) — **paginated** |
| `GET` | `/api/v1/sessions/:id` | Bearer | Get session details |
| `PATCH` | `/api/v1/sessions/:id` | Bearer (studio/admin) | Update protocol / complete draft |

### Cases — testing notes

1. Register customer with `studio_code: "INKFREE"`, login, authorize in Swagger.
2. **POST `/cases`** — creates case with auto `caseId` (e.g. `#UNT-001` from title "Unterarm").
3. **GET `/cases`** — lists cases scoped to role (customer = own cases only).
4. **PATCH `/cases/:id`** — customers can update intake fields; studio/admin can update `status`, `pricePerSession`, etc.

**Case `status` values (English):** `pending` · `active` · `completed` · `loeschantrag_ausstehend`  
(User/studio account status uses German: `ausstehend` · `aktiv` · `gesperrt`.)

**Pricing:** `pricePerSession` is hidden from customer API responses (internal studio field per client spec).

### Pagination (list endpoints)

All list routes accept optional query params:

| Param | Default | Max | Description |
|---|---|---|---|
| `page` | `1` | — | Page number (1-based) |
| `limit` | `20` | `100` | Items per page |

Response shape (replaces former top-level `count`):

```json
{
  "success": true,
  "data": {
    "cases": [ "...or appointments / sessions..." ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3,
      "hasNextPage": true,
      "hasPrevPage": false
    }
  }
}
```

Example: `GET /cases?page=2&limit=10&status=active`

### Cases — availability / lockout

1. **GET `/cases/:id/availability?from=2026-06-01&to=2026-10-15`** — returns `fruehestes`, `sperren`, `frei_fenster`, `blocked_dates`.
2. Optional query: `consultationOnly=true` (no lockouts), `uv_level=moderate|intense` (pre-session UV preview).
3. Rules (client §5): same-case **49 days**, cross-case **28 days**, UV/meds global blocks; longest wins.
4. Customer **POST/PATCH appointments** on blocked dates → `400`. Studio/admin bypass lockout.

### Appointments — testing notes

1. Create a case first (`POST /cases`), copy the case `id`.
2. **POST `/appointments`** example:
   ```json
   {
     "case_id": "YOUR_CASE_ID",
     "date": "2026-07-15T08:00:00.000Z",
     "time": "10:00",
     "consultationOnly": true,
     "standort_name": "Aesch BL",
     "dauer_minuten": 30
   }
   ```
3. **PATCH** to cancel: `{ "status": "storniert" }` — writes `cancelled` to case `activityLog`.
4. **Group booking:** set `gruppen_termin: true` and `gruppen_cases: ["caseId2"]` (same customer).

> Customer booking/reschedule enforces lockout via `berechneAlleSperren`. Studio/admin bypass validation.

### Sessions — testing notes

1. Login as **super admin** (`admin@elaya.ch`) or studio staff — customers cannot POST sessions.
2. **POST `/sessions`** — use your case `id`:
   ```json
   {
     "case_id": "YOUR_CASE_ID",
     "treatment_date": "2026-07-20T08:00:00.000Z",
     "treatment_time": "10:00",
     "wavelength_nm": [1064],
     "fluence_j_cm2": 3.8,
     "removal_pct": 12,
     "zahlung": { "betragCHF": 180, "waehrung": "CHF", "zahlungsart": "karte" }
   }
   ```
3. Case auto-updates: `sessionsDone`, `lastSessionDate`, `removal`, `status → active`.
4. Customer can **GET `/sessions?case_id=...`** — sees progress only (no laser/payment details).

### Elaycoins — testing notes

1. **GET `/elaycoins/me`** (customer) — balance, transactions, expiry status (6 warning levels).
2. **GET `/elaycoins/customers/:customerId`** (studio/admin) — use **Customer document ID** (`user.customer_id` from `/auth/me`), not User ID.
3. **Rewards** auto on session save (non-draft, non-no-show): `termin_wahrgenommen` (+100), milestones at 3/5/10 sessions, `behandlung_abgeschlossen`.
4. **Malus:** `no_show` (−150 max, never negative) on no-show session; `kurzfristige_stornierung` (−80) when cancel/reschedule **&lt;24h before** appointment time (must be future and within 24h).
5. Platform limits: 100 coins = CHF 5 · daily cap 800 · max single grant 1000 · 12-month inactivity expiry.

**Verified locally (2026-06-26):** 3 sessions + milestone → 450 coins; no-show −150 → 300; kurzfristige cancel −80 → 220.

### Config (platform + studio feature flags)

Maps prototype `elaya_admin_config` → `platform_config` and `inkderm_pricing` → `studio_pricing` (client §2).

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/config/public` | Bearer (all roles) | Group booking sizes + Elaycoin display limits |
| `GET` | `/api/v1/config/platform` | Admin | Full platform config (Elaycoin, finance, group booking) |
| `PATCH` | `/api/v1/config/platform` | Admin | Update platform config (partial) |
| `GET` | `/api/v1/config/studio` | Studio staff/admin | Own studio pricing + Elaycoin overrides |
| `PATCH` | `/api/v1/config/studio` | Studio admin | Update own `studio_pricing`, `elaycoin_studio_cfg`, `coin_wert` |
| `GET` | `/api/v1/config/studios/:studioId` | Admin | Studio config by ID |
| `PATCH` | `/api/v1/config/studios/:studioId` | Admin | Update any studio config |

**Platform defaults (client handoff):** `coinWert:0.10`, `minWert:0.05`, `maxWert:0.20`, `deckelProzent:20`, `verfallMonate:12`, `grundgebuehr:149`, `transaktionsProzent:3`, `zahlungszielTage:30`, `gruppen_groessen:{ klein_max_cm2:50, mittelgross_max_cm2:150, max_punkte:4, gruppen_rabatt:0.15 }`.

**Testing:** Login as admin → `GET /config/platform`. Patch → `PATCH /config/platform` with `{ "gruppen_groessen": { "gruppen_rabatt": 0.15 } }`. Customer → `GET /config/public`. Studio admin (`studio@inkfree.ch`) → `GET/PATCH /config/studio`. Admin → `GET/PATCH /config/studios/{studioId}` (studioId from seed output or GET `/cases` → `studio` field).

**Verified locally (2026-06-27):** platform PATCH, customer public config, admin studio-by-id, studio admin own config — all pass in Swagger.

---

## Auth design

- **One shared auth system** for customer, studio, and admin (same JWT).
- **Separate registration flows** — customer vs studio (different business rules).
- **No public admin signup** — first super admin via one-time bootstrap; further admins via admin dashboard (planned).
- **Field names** in API/DB are **German** per client spec (`vorname`, `nachname`, `telefon`, etc.).
- **Code** (files, functions, variables) stays in **English**.
- See `config/fieldReference.js` for a German → English field cheat sheet (developer reference only).

### Roles

| Role | Description |
|---|---|
| `customer` | Customer app user |
| `studio_staff` | Studio employee |
| `studio_admin` | Studio owner |
| `admin` | Platform admin |
| `super_admin` | Platform super admin |
| `developer` | Read-only dev access (planned) |

---

## Swagger — how to authorize

1. Open `http://localhost:4000/api/v1/docs`
2. Read the **Role legend** at the top of the docs page
3. Every endpoint shows **Auth** and **Who can call** in its description (highlighted box)
4. Run **`POST /auth/login`** with admin, studio, or customer credentials
5. Copy `data.accessToken` from the response
6. Click **Authorize** (lock icon, top right)
7. Enter: `Bearer <your-access-token>`
8. Call protected routes

Access tokens expire in 15 minutes. Use **`POST /auth/refresh`** to get a new one (refresh token is in an HttpOnly cookie after login).

---

## Dev seed data

After `npm run seed:dev`:

| Item | Value |
|---|---|
| Super admin email | `admin@elaya.ch` |
| Super admin password | `Admin1234!` — dev only, never use in production |
| Studio admin email | `studio@inkfree.ch` |
| Studio admin password | `Studio1234!` — dev only |
| Pilot studio code | `INKFREE` |
| Pilot studio | inkFree (Aesch BL + Schaffhausen) |

Seed also prints `INKFREE studio id:` — use for `GET /config/studios/{studioId}`.

Use `studio_code: "INKFREE"` when testing customer registration.

---

## Production deployment (Railway)

Planned layout:

```
Frontend (React)  →  Vercel
Backend (Express) →  Railway
MongoDB           →  Railway MongoDB or MongoDB Atlas (EU region)
```

### Railway checklist

1. Connect GitHub repo — set root directory to `backend`
2. Start command: `npm start` (bootstrap is **not** part of start — run separately once)
3. Add all env vars from `.env.example` (strong JWT secrets in production)
4. Add MongoDB — paste `MONGO_URI` into backend service
5. **Bootstrap the first super admin once** (see below)
6. Set frontend `CORS_ORIGINS` to your Vercel URL(s)
7. Point frontend API base URL to Railway URL: `https://<app>.up.railway.app/api/v1`

### First super admin (production bootstrap)

Industry pattern: **never auto-create admins on server start**. Run a guarded one-time script after the first deploy.

1. In Railway, temporarily add:
   ```
   BOOTSTRAP_ADMIN_ENABLED=true
   BOOTSTRAP_ADMIN_EMAIL=admin@yourdomain.ch
   BOOTSTRAP_ADMIN_PASSWORD=<long-random-password-min-12-chars>
   ```
2. Run once against production DB (Railway one-off shell or local with production `MONGO_URI`):
   ```bash
   npm run bootstrap:admin
   ```
3. **Immediately remove** `BOOTSTRAP_ADMIN_*` vars from Railway — they are not needed at runtime.
4. Log in via `POST /api/v1/auth/login` and verify with `GET /api/v1/auth/me`.
5. Create additional admins through the **Admin Dashboard** once that UI exists (no public admin register endpoint).

**Guards built in:**
- Refuses unless `BOOTSTRAP_ADMIN_ENABLED=true`
- Refuses if any `super_admin` already exists
- Refuses if email is already taken
- `seed:dev` is blocked when `NODE_ENV=production`

**Changing admin later:** use the admin dashboard (planned), or a controlled internal procedure — not re-running bootstrap or seed.

> **Note:** Client docs require Swiss/EU hosting for DSG/GDPR. Confirm MongoDB region and Railway deployment region with the client before go-live.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start with nodemon |
| `npm start` | Production start |
| `npm run seed:dev` | Local dev only — admin + studio admin + pilot studio INKFREE (blocked in production) |
| `npm run bootstrap:admin` | One-time production super admin (guarded) |

---

## Conventions

- **API/DB fields:** German names from client handoff (`DEVELOPER-HANDOFF-EN.md`)
- **Internal code:** English (controllers, middleware, file names)
- **Validation:** Zod schemas in `validators/`
- **Errors:** `{ success: false, message, errors? }`
- **Success:** `{ success: true, data?, message? }`

---

## Related docs

- `../DEVELOPER-HANDOFF-EN.md` — Full platform spec and field definitions
- `../ELAYA-DOCS-FOR-CLIENT.pdf` — Milestones and architecture
- `config/fieldReference.js` — Developer field name cheat sheet (local only, not in git)

---

## Updating this README

When you finish a feature, update:

1. **Current progress** table (status + notes)
2. **Changelog** (date + one line)
3. **API endpoints** section if new routes were added
4. **Last updated** date at the top

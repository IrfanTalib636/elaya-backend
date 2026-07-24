# Elaya Backend API

Shared REST API for the Elaya platform — Customer Web Portal, Studio Web Dashboard, Admin Dashboard, and future mobile apps.

**Stack:** Node.js · Express 5 · MongoDB · Mongoose · JWT · Zod  
**API base path:** `/api/v1`  
**Planned production host:** [Railway](https://railway.app)  
**Last updated:** 2026-07-20

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
| Pagination test seed | ✅ Done | `npm run seed:pagination` — 30 customers/cases/sessions for INKFREE (local only) |
| Production admin bootstrap | ✅ Done | `npm run bootstrap:admin` — one-time, guarded |
| User / Customer / Studio models | ✅ Done | |
| **Week 2 — Cases, booking, engines** | ✅ **100%** | Complete |
| Case / CaseZone / Anamnesis models | ✅ Done | Normalized per client §2 mapping |
| Appointment / Session models | ✅ Done | Normalized per client §2 mapping |
| **Case intake (8-step fields)** | ✅ Done | Full prototype intake on POST/PATCH `/cases` — see `../docs/CUSTOMER-CASE-INTAKE-SPEC.md` (local docs) |
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

### M2 additions (frontend integration support)

| Area | Status | Notes |
|---|---|---|
| Customer CRUD API | ✅ Done | GET/POST `/customers`, GET/PATCH `/customers/:id` — studio-scoped |
| Customer Zod validator | ✅ Done | `validators/customerValidator.js` — create / update / list-query schemas |
| Appointment populate | ✅ Done | `listAppointments` + `getAppointment` populate customer + case |
| Case list populate | ✅ Done | `listCases` populates `customer` (vorname, nachname, email) |
| Session list populate | ✅ Done | `listSessions` populates `case` + `customer` |
| Studio settings API | ✅ Done | GET/PATCH `/studio/settings` — profile, hours, rooms, staff, buffer time |

**M2 (Studio dashboard):** ✅ Complete — shop orders API, analytics summary, CRM Phase 2, Elaycoins studio overview.

**CRM:** `GET/POST/PATCH/DELETE /studio/crm/tasks`, notes, templates, pipeline.

**Shop:** `GET /studio/shop/orders`, `PATCH /studio/shop/orders/:id` (status only). Customer catalog/checkout: `GET/POST /shop/*`. Seeds: `npm run seed:shop` (orders), `npm run seed:shop-products` (catalog).

**Studio transfer:** `POST/GET /studio-transfers`, `PATCH …/approve|reject` (admin API). Studio UI: `/studio/transfers` (read-only queue).

**Analytics:** `GET /studio/analytics/summary` — revenue by akquise, platform fee, shop provision, coins.

**Elaycoins:** `GET /elaycoins/studio/overview` — paginated customer balances.

### M2 close-out & financier demo (2026-07-11 — 2026-07-13)

| Area | Status | Notes |
|---|---|---|
| **Forgot / reset password** | ✅ Done | `POST /auth/forgot-password`, `POST /auth/reset-password` — portals: `studio`, `admin`, `customer` (mobile) |
| **Email service** | ✅ Done | Nodemailer — console (local) or SMTP (production); `APP_FRONTEND_URL`, `APP_CUSTOMER_RESET_URL` |
| **Anamnesis API** | ✅ Done | `GET/PUT /cases/:id/anamnesis` — separate `anamnesis` collection, ampel engine |
| **Admin studio approval** | ✅ Done | `GET/PATCH /studio/admin/studios` — list pending + activate |
| **Lockout engine (demo-ready)** | ✅ Done | 49-day same-case, 28-day cross-case, pre-session UV/meds; studio booking validation |
| **Case customer populate** | ✅ Done | `GET /cases/:id` returns customer name fields |
| **Customer detail case scope** | ✅ Done | Studio users only see cases at their studio |
| **Financier demo seed** | ✅ Done | `npm run seed:demo` — Maria Tribal, `#TRI-001` + `#HAN-001` on INKFREE |
| **Public studio list (registration)** | ✅ Done | `GET /studios/public` — active studios with address + standorte for customer signup dropdown |

**Mobile app developer guide:** [`../MOBILE-APP-DEVELOPER.md`](../MOBILE-APP-DEVELOPER.md) — screen flows, 6 tabs, tattoo + PMU wizard, API mapping for iOS/native app. **Keep in sync:** when adding or changing customer-facing APIs, update this guide alongside `backend/README.md` and `frontend/README.md`. *(Local monorepo doc — not in this GitHub repo.)*

**Financier demo verified locally:** lockout panel, blocked booking, Beratung bypass, pre-session UV/meds (longest lockout wins), appointment recalculates lockout.

### Medical / booking parity with prototype (Phases A–E · 2026-07-16)

| Phase | Status | Notes |
|---|---|---|
| **A — Ampel + inline hints** | ✅ Done | `POST /cases/:id/anamnesis/preview`, `PUT` anamnesis, `medical_flag_level` on case |
| **B — Merkblatt + signature** | ✅ Done | `GET …/merkblatt`, `POST …/signature`, `GET …/signature/image` |
| **C — Ampel on CRM / lists** | ✅ Done | Worst flag on customer detail + CRM pipeline/tasks; `GET /cases?medical_flag=` |
| **D — PS_01 booking pre-check** | ✅ Done | `GET/POST …/booking-precheck`, customer `POST /appointments` requires `booking_precheck` |
| **E — Klaerung + freigabe + audit** | ✅ Done | `PATCH …/anamnesis/klaerung`, `PATCH …/studio-freigabe`; original answers immutable; `audit_log` |

**Swagger:** all of the above are documented under `/api/v1/docs` (Cases + Appointments tags).

### PMU intake + private photo storage (2026-07-17)

| Area | Status | Notes |
|---|---|---|
| **PMU intake fields** | ✅ Done | `pmu_type`, `pmu_age_range`, `colors`, `paradox_darkening_acknowledged`, … on POST/PATCH `/cases` |
| **PMU pricing engine** | ✅ Done | `calcPmuSessions()` — session min/max + CHF on create |
| **Private file storage** | ✅ Done | VPS disk + MongoDB metadata — no public URLs |
| **Staging upload** | ✅ Done | `POST /files/staging` — intake photos before case save |
| **Case intake link** | ✅ Done | `photo_intake_*` + zone `foto_url` linked on `POST /cases` |
| **Authenticated serve** | ✅ Done | `GET /files/:id/content` — Bearer only, audit log |

**Env:** `UPLOAD_ROOT`, `UPLOAD_MAX_BYTES`, `UPLOAD_STAGING_TTL_HOURS` (see `.env.example`).

### ElayShop catalog + customer checkout (2026-07-18)

| Area | Status | Notes |
|---|---|---|
| **Product catalog** | ✅ Done | `ShopProduct` model — ELY-001…005 via `npm run seed:shop-products` |
| **GET catalog** | ✅ Done | `GET /shop/products`, `GET /shop/products/:id` |
| **Shipping** | ✅ Done | `GET /shop/shipping` — CH/EU rates + free thresholds (prototype) |
| **Customer checkout** | ✅ Done | `POST /shop/orders` — client cart; server prices + shipping; payment simulated |
| **Customer order history** | ✅ Done | `GET /shop/orders`, `GET /shop/orders/:id` |
| **Studio order list** | ✅ Done | Existing `GET/PATCH /studio/shop/orders` (shows new customer orders) |
| **Elaycoin on purchase** | ✅ Done | `erster_einkauf` + `nachsorge_produkt_gekauft` on create |

Cart stays **client-side** (mobile). Admin product CRUD UI → M4.

### Studio transfer / Firmenwechsel (2026-07-20 · M3)

| Area | Status | Notes |
|---|---|---|
| **Transfer request model** | ✅ Done | `StudioTransferRequest` — `ausstehend` / `genehmigt` / `abgelehnt` |
| **Customer request** | ✅ Done | `POST /studio-transfers` — 3 consents + signature |
| **Customer history** | ✅ Done | `GET /studio-transfers/me` |
| **Studio queue** | ✅ Done | `GET /studio-transfers` — **eingehend** (target) + **ausgehend** (source); admin sees all |
| **Approve / reject** | ✅ Done | `PATCH …/approve`, `PATCH …/reject` — **admin / super_admin only** (Handoff §10.15; admin UI → M4) |
| **Shared Case Layer** | ✅ Done | Target studio: full Akte + sessions/files, cases marked `transferiert`. Source: own cases read-only. Elaycoins stay on customer |
| **Customer detail enrichments** | ✅ Done | `firma_timeline`, `wechsel_status`, `vorheriges_studio_name`, `aktuelle_firma_name` on `GET /customers/:id` |
| **Transfer list dates** | ✅ Done | `beitritt_quelle_am`, `wechsel_genehmigt_am`, `richtung` on list response |

**Follow-up (M4+):** Admin dashboard Studio-Wechsel page. **Email notifications** on approve/reject (customer + both studios) — reuse `services/emailService.js` (Handoff §10.15).

### Customer profile (mobile · 2026-07-21 · M3)

| Area | Status | Notes |
|---|---|---|
| **Edit profile** | ✅ Done | `PATCH /customers/me` — vorname, nachname, telefon, email, address, geburtsdatum |
| **Profile bootstrap** | ✅ Done | `GET /auth/me` includes `firma_timeline`, `studio` embed, `elaycoins_balance` |
| **DSG data export** | ✅ Done | `GET /customers/me/export` — live JSON of profile, cases+anamnese, sessions, appointments, coins+tx, shop orders, transfers; filename `{Name}_Meine-Daten_{date}.json` |
| **Transfer protocol** | ✅ Done | `GET /customers/me/transfer-protocol` — after admin-approved transfer (`genehmigt`) |

**Known gaps (post-M2):** Admin dashboard UI for studio approval, zone-level lockout in customer mobile booking, full pricing multipliers UI. Case chat CRUD still stub-only. Real Stripe/Twint payment later.

### AI Nachsorge / aftercare (2026-07-23)

| Area | Status | Notes |
|---|---|---|
| **Anthropic proxy** | ✅ Done | Server-side only — `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default Sonnet), `AI_ENABLED` |
| **Photo upload** | ✅ Done | `POST /files/staging` with `slot=nachsorge` → `foto_file_id` |
| **Stage 1 photo-check** | ✅ Done | `POST /nachsorge/photo-check` — vision-only ampel |
| **Stage 2 check** | ✅ Done | `POST /nachsorge/check` — photo + symptoms (photo wins), persist, `nachsorge_check` coins |
| **History** | ✅ Done | `GET /nachsorge`, `GET /nachsorge/:id` |
| **Swagger Files** | ✅ Done | `POST /files/staging` documented under **Files** tag |
| **E2E smoke** | ✅ Verified | 2026-07-23 — upload → photo-check → check (+50 coins) → list/detail (`ai_available: true`) |
| **Verblassung AI** | ✅ Done | `POST /verblassung` — before/after fading % on session; syncs case `removal` |
| **Elaya FAB chat** | ✅ Done | `POST /chat` — customer + studio context; `erster_elaya_chat` coins |

**Fallback:** If key missing / `AI_ENABLED=false`, endpoints return orange “manual review” payload (`ai_available: false`) without crashing.

**Photos:** Prefer private file IDs via `POST /files/staging` (`slot=nachsorge`). Do not send base64 images in JSON for production; if you temporarily test base64 payloads elsewhere, raise `JSON_BODY_LIMIT` in `.env` (default `512kb`). Restart the API after changing `ANTHROPIC_*` in `.env`.

### AI Verblassung / fading (2026-07-23)

| Area | Status | Notes |
|---|---|---|
| **Analyze** | ✅ Done | `POST /verblassung` `{ session_id, foto_vorher_file_id?, foto_aktuell_file_id?, persist? }` — studio/admin only |
| **Photos** | ✅ Done | Defaults: aktuell = session progress file; vorher = prior session progress or case intake main |
| **Persist** | ✅ Done | Writes `verblassung_prozent`, `removal_pct`, `verblassung_ki`; syncs case `removal` |
| **Customer read** | ✅ Done | `GET /sessions` includes `%` + customer-safe KI text (no `empfehlung_studio` / raw AI) |
| **Progress upload** | ✅ Done | `POST /files/sessions/:id/progress` sets `fortschritt_foto_file_id` |
| **E2E smoke** | ✅ Verified | 2026-07-23 — progress upload → `/verblassung` (`ai_available: true`, persisted); empty optional photo ids accepted |
| **Studio UI** | ⏳ Later | Session “KI-Verblassung” button |

**Disk path:** `uploads/{studioId}/sessions/{sessionId}/progress.jpg` (not under `staging/`).

### AI Elaya FAB chat (2026-07-24)

| Area | Status | Notes |
|---|---|---|
| **Endpoint** | ✅ Done | `POST /chat` `{ message, case_id?, history? }` — customer + studio/admin |
| **Context** | ✅ Done | Server builds profile (cases, ampel, sessions, lockouts, appointments) |
| **Coins** | ✅ Done | Customer `erster_elaya_chat` (+30, einmalig) |
| **Escalation** | ✅ Done | Parses `[ESKALATION|…]` → `data.eskalation` (stripped from reply) |
| **Suggested actions** | ✅ Done | Heuristic tags e.g. `termin_buchen`, `nachsorge` (customer) |
| **Mobile / studio FAB UI** | ⏳ Later | Wire floating button to this API |

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
[2026-07-01] — Customer CRUD API (GET/POST /customers, GET/PATCH /customers/:id) with Zod schemas + Swagger
[2026-07-01] — Appointment populate: customer name + case info returned in list/detail responses
[2026-07-02] — Studio settings API — GET/PATCH /studio/settings (profile, öffnungszeiten, räume, mitarbeiter); admin by studioId
[2026-07-03] — listCases + listSessions populate for studio list pages; dev seed default room + staff
[2026-07-06] — M2: CRM API (pipeline, tasks, notes, templates) + pipeline engine
[2026-07-06] — M2: Shop orders API + seed:shop; analytics summary (aggregations); elaycoins studio overview
[2026-07-06] — studioScope helper; session index for analytics; Swagger on studio CRM/shop/analytics routes
[2026-07-11] — Forgot/reset password API + password reset tokens + email service (studio/admin/customer portals)
[2026-07-11] — Anamnesis API (GET/PUT /cases/:id/anamnesis) + ampel engine
[2026-07-11] — Admin studio list + activate endpoints
[2026-07-11] — Lockout: pre-session UV/meds in availability + booking; studio booking validation
[2026-07-11] — seed:demo financier script (#TRI-001 + #HAN-001); customer detail cases scoped to studio
[2026-07-13] — Financier demo lockout flow re-verified (49/28-day, Beratung, pre-session, recalc after booking)
[2026-07-13] — GET /studios/public — active studios for customer registration dropdown (name + address + standorte)
[2026-07-16] — Phase A–E medical: anamnesis preview, signature, CRM ampel, PS_01 booking-precheck, klaerung + freigabe + audit
[2026-07-17] — PMU intake fields + pricing engine; private photo storage API (staging, case link, authenticated content)
[2026-07-18] — ElayShop: product catalog, shipping quote, customer POST/GET orders; seed:shop-products
[2026-07-20] — Studio transfer (M3): Shared Case Layer, /studio-transfers API, firma_timeline, inbound+outbound studio queue
[2026-07-21] — Customer profile (M3): PATCH /customers/me, DSG export, transfer protocol, firma_timeline on GET /auth/me
[2026-07-21] — M3 polish: GET /studios/public returns id; Kunden list includes transferred-out customers as inactive
[2026-07-23] — AI Nachsorge: POST /nachsorge/photo-check + /check, GET history; Anthropic server proxy (Sonnet default)
[2026-07-23] — Nachsorge E2E verified in Swagger; Files staging documented; Files + Nachsorge OpenAPI complete
[2026-07-23] — AI Verblassung: POST /verblassung before/after fading analysis; session KI fields + case removal sync
[2026-07-23] — Verblassung E2E verified; optional empty photo ids in Swagger; progress files under uploads/{studio}/sessions/
[2026-07-24] — AI Elaya FAB chat: POST /chat with server context, escalation parse, erster_elaya_chat coins
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
│   ├── studioDefaults.js  # Opening hours defaults + staff roles
│   └── swagger.js         # OpenAPI / Swagger UI setup
├── controllers/
│   ├── anamnesisController.js
│   ├── appointmentController.js
│   ├── bookingPrecheckController.js
│   ├── authController.js
│   ├── caseController.js
│   ├── configController.js
│   ├── elaycoinController.js
│   ├── sessionController.js
│   ├── signatureController.js
│   ├── studioController.js
│   └── studioTransferController.js
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
│   ├── passwordResetTokenModel.js
│   ├── refreshTokenModel.js
│   ├── sessionModel.js
│   ├── studioModel.js
│   ├── studioTransferRequestModel.js
│   └── userModel.js
├── routes/
│   ├── appointmentRoute.js
│   ├── authRoute.js
│   ├── caseRoute.js
│   ├── configRoute.js
│   ├── elaycoinRoute.js
│   ├── healthRoute.js
│   ├── sessionRoute.js
│   ├── studioRoute.js
│   ├── studioTransferRoute.js
│   └── index.js
├── scripts/
│   ├── bootstrapAdmin.js  # One-time production super admin (guarded)
│   ├── seedDemo.js        # Financier demo — #TRI-001 + #HAN-001 (local; VPS with SEED_DEMO_ALLOW_PRODUCTION=1)
│   └── seedDev.js         # Local dev fixtures only — blocked in production
├── validators/
│   ├── anamnesisValidator.js
│   ├── appointmentValidator.js
│   ├── authValidator.js
│   ├── caseValidator.js
│   ├── configValidator.js
│   ├── paginationValidator.js
│   ├── sessionValidator.js
│   ├── studioTransferValidator.js
│   └── studioValidator.js
├── services/
│   └── emailService.js          # Password reset emails (console / SMTP)
├── utils/
│   ├── accessHelpers.js         # Shared Case Layer + role/access checks (cases, sessions, customers)
│   ├── anamnesisEngine.js       # Medical anamnesis ampel + klaerung-aware effective status
│   ├── ApiError.js
│   ├── asyncHandler.js
│   ├── bookingPrecheckEngine.js # PS_01 validation (UV/meds/KO/wiederholungen)
│   ├── bookingPrecheckApply.js  # Persist PS_01 side effects on appointment book
│   ├── generateCaseId.js
│   ├── generateTokenAndSetCookies.js
│   ├── lockoutEngine.js         # berechneAlleSperren — 49/28-day, UV/meds, pre-session
│   ├── medicalFlagHelpers.js    # Worst medical flag aggregation for CRM/customers
│   ├── passwordReset.js         # Token issue/verify + portal-scoped reset
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
npm run seed:pagination     # optional — 30 pagtest customers for pagination UI (local only)
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

### Studios (public)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/studios/public` | No | Active studios for customer registration — returns `studio_code`, `firma`, address, `standorte` |

#### Customer registration flow (mobile / web)

1. **`GET /api/v1/studios/public`** — load dropdown; display `firma` plus primary address (`strasse`, `plz`, `ort`) and any `standorte` rows.
2. User selects a studio — keep its **`studio_code`** (e.g. `INKFREE`).
3. **`POST /api/v1/auth/register/customer`** — send profile fields plus `studio_code`:

```json
{
  "vorname": "Maria",
  "nachname": "Muster",
  "email": "maria@example.com",
  "telefon": "+41 79 123 45 67",
  "password": "SecurePass123!",
  "studio_code": "INKFREE",
  "geburtsdatum": "1990-05-15",
  "strasse": "Musterstrasse 1",
  "plz": "4000",
  "ort": "Basel",
  "land": "Schweiz"
}
```

Only studios with status **`aktiv`** appear in the public list. Pending (`ausstehend`) or locked (`gesperrt`) studios are excluded. For **studio transfer**, customer/mobile uses target studio id (`zu_firma_id`) — add `id` to this response in a follow-up (currently `studio_code` only).

### Studio transfers (Firmenwechsel)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/studio-transfers` | Customer | Create transfer request (`ausstehend`) |
| `GET` | `/api/v1/studio-transfers/me` | Customer | Own transfer history |
| `GET` | `/api/v1/studio-transfers` | Studio / Admin | Studio: inbound + outbound for own studio; admin: all |
| `GET` | `/api/v1/studio-transfers/:id` | Customer / Studio / Admin | Single request |
| `PATCH` | `/api/v1/studio-transfers/:id/approve` | Admin | Approve — activates Shared Case Layer |
| `PATCH` | `/api/v1/studio-transfers/:id/reject` | Admin | Reject — `{ "ablehnungsgrund": "…" }` required |

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

### Files (private photos)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/files/staging` | Bearer | Upload intake photo before case save — multipart `file`, `slot`, optional `customer_id` |
| `POST` | `/api/v1/files/cases/:caseId/intake` | Bearer (studio) | Upload intake photo to existing case |
| `POST` | `/api/v1/files/sessions/:sessionId/progress` | Bearer (studio) | Session progress photo |
| `GET` | `/api/v1/files/:fileId` | Bearer | File metadata |
| `GET` | `/api/v1/files/:fileId/content` | Bearer | Image bytes (no public URL) |
| `DELETE` | `/api/v1/files/:fileId` | Bearer | Delete unlinked staging file |

Case fields `photo_intake_main`, `photo_intake_detail`, `photo_marker`, and zone `foto_url` store **file asset IDs** returned from staging upload. Linked automatically on `POST /cases` via `linkCaseIntakeFiles`.

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

### Studio settings (profile, hours, rooms, staff)

Maps prototype settings tabs → `Studio` document fields (separate from pricing in `/config/studio`).

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/studio/settings` | Studio staff/admin | Own studio profile, öffnungszeiten, behandlungsraeume, mitarbeiter, pufferzeit |
| `PATCH` | `/api/v1/studio/settings` | Studio admin | Partial update — send only sections to change |
| `GET` | `/api/v1/studio/studios/:studioId/settings` | Admin | Studio settings by ID |
| `PATCH` | `/api/v1/studio/studios/:studioId/settings` | Admin | Update any studio settings |

**Response shape (`data.settings`):**

- `profile` — `firma`, `email`, `telefon`, address fields, `studio_code`, `status`, `notizen` (email read-only)
- `oeffnungszeiten` — keys `mo`–`so`, each `{ offen, von, bis }` (defaults merged on read)
- `behandlungsraeume[]` — `{ id, name, farbe, aktiv, laser_brand, laser_model }`
- `mitarbeiter[]` — `{ id, vorname, nachname, rolle, raum_id, aktiv, user_id }` (roster only; login invite flow post-M2)
- `pufferzeit_minuten` — buffer after appointments (0–120)

**PATCH notes:**

- `profile`, `oeffnungszeiten`, and `pufferzeit_minuten` are partial merges.
- `behandlungsraeume` and `mitarbeiter` **replace the full array** when sent — include existing items you want to keep.
- `mitarbeiter[].raum_id` must reference a room `id` from the current roster (validated on save).
- Staff roles: `Studiobetreiber`, `Laser-Therapeutin`, `Empfang`, `Andere`.

**Testing:** Login as studio admin (`studio@inkfree.ch`) → `GET /studio/settings`. Patch profile: `{ "profile": { "telefon": "+41 61 123 45 67" } }`. Patch hours: `{ "oeffnungszeiten": { "so": { "offen": true } } }`. Admin → `GET/PATCH /studio/studios/{studioId}/settings`.

**Dev seed:** `npm run seed:dev` adds a default Laser 1 room + sample staff member when the INKFREE studio has none.

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

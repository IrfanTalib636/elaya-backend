# Elaya Backend API

Shared REST API for the Elaya platform — customer mobile app, Studio Web Dashboard, and Admin Dashboard.

**Stack:** Node.js · Express 5 · MongoDB · Mongoose · JWT · Zod  
**API base path:** `/api/v1`  
**Planned production host:** [Railway](https://railway.app)  
**Last updated:** 2026-08-29

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
| Pricing engine | ✅ Done | Excel PriceFormula + Multipliers — GET `/cases/:id/pricing` (role-scoped; customers never see multipliers) |
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
| **Delete account** | ✅ Done | `DELETE /customers/me` — permanent, irreversible erasure of the account (App Store privacy requirement). See [Permanent account deletion](#permanent-account-deletion) |

**Known gaps (post-M2):** Admin dashboard UI for studio approval, zone-level lockout in customer mobile booking, full pricing multipliers UI. Real Stripe/Twint payment later.

### Studio ↔ customer live chat (Socket.io · 2026-08-05)

| Area | Status | Notes |
|---|---|---|
| **REST inbox** | ✅ Done | `GET/POST /messaging/conversations`, messages + read receipts |
| **Socket.io** | ✅ Done | JWT auth (`handshake.auth.token`), rooms, send/typing/read events |
| **Models** | ✅ Done | `ChatConversation` + `ChatMessage` (one thread per customer↔studio) |
| **Mobile / studio UI** | ✅ Done | Mobile Chat tab + studio `/studio/chat` (JWT Socket.io) |
| **AI FAB** | Separate | Keep using `POST /chat` — do **not** merge with live chat |

**Socket connect:** `io(API_ORIGIN, { path: '/socket.io', auth: { token: accessJwt } })`

**Client → server events:** `messaging:join` · `messaging:leave` · `messaging:send` · `messaging:typing` · `messaging:read`  
**Server → client events:** `messaging:connected` · `messaging:message` · `messaging:conversation_updated` · `messaging:typing` · `messaging:read` · `messaging:error`

Optional `SOCKET_IO_PATH` (default `/socket.io`).

**Other server → client events on the same connection:** `studio:schedule_updated`, `config:session_prediction_updated`, `customer:availability_changed`, `studio:availability_changed`. Clients multiplex all of these over **one** socket — see the availability events above.

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
| **Healing logic (§9)** | ✅ Done | `healingLogicEngine.js` — phases 1–7 / 8–21 / >21; status `normal \| monitor \| conspicuous \| delayed`; delayed is never date-only |
| **Studio review** | ✅ Done | `PATCH /nachsorge/:id/review` — confirm or correct healing status + notes |
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
| **Customer read** | ✅ Done | `GET /sessions` includes `%` only when `comparison_eligible`; otherwise `too_early` / `no_reliable_comparison` (no invented %) |
| **Progress upload** | ✅ Done | `POST /files/sessions/:id/progress` sets `fortschritt_foto_file_id` |
| **E2E smoke** | ✅ Verified | 2026-07-23 — progress upload → `/verblassung` (`ai_available: true`, persisted); empty optional photo ids accepted |
| **First-session skip** | ✅ Done | Session 1 has no KI fading analysis (`ki_analysis_available: false`) |
| **Studio UI** | ✅ Done | Session detail — studio % override, photo flags, internal estimate |

**Disk path:** `uploads/{studioId}/sessions/{sessionId}/progress.jpg` (not under `staging/`).

### AI Elaya FAB chat (2026-07-24)

| Area | Status | Notes |
|---|---|---|
| **Endpoint** | ✅ Done | `POST /chat` `{ message, case_id?, history? }` — customer + studio/admin |
| **Context** | ✅ Done | Server builds profile (cases, ampel, sessions, lockouts, appointments) |
| **Coins** | ✅ Done | Customer `erster_elaya_chat` (+30, einmalig) |
| **Escalation** | ✅ Done | Parses `[ESKALATION|…]` → `data.eskalation` (stripped from reply) |
| **Suggested actions** | ✅ Done | Heuristic tags e.g. `termin_buchen`, `nachsorge` (customer) |
| **Mobile / studio FAB UI** | ✅ Done | Studio `/studio/elaya`; mobile Chat tab |

### Master Excel domain engines (IT_Clarifications · 2026-08-19)

Leading domain source: [`../masterExcelFile_EN.xlsx`](../masterExcelFile_EN.xlsx) (German original: `../masterExcelFile.xlsx`). CSV exports are technical imports only — if they differ, **Master Excel + IT_Clarifications win**.

**Source of truth if unclear:** 1) IT_Clarifications → 2) README_ClaudeCode → 3) PriceFormula / Multipliers / PriceCalculator / Examples → 4) `*_Master` sheets → 5) questionnaire / progress sheets. Returned on `GET /config/platform` as `domain_source_of_truth`.

| Area | Status | Notes |
|---|---|---|
| **Price formula + multipliers** | ✅ Done | `pricingEngine.js` — Fläche × Basis × Farbe × Tiefe × Alter × Haut × Stelle × CoverUp × Ziel; `MAX(Mindestpreis, round-up 5 CHF)` |
| **Session forecast** | ✅ Done | `sessionPredictionEngine.js` + `lifestyleCompositeEngine.js` — SessionForecast + SessionLogic_Master |
| **Excel examples (§7)** | ✅ Done | `npm run verify:examples` — three Master Excel cases (age 3y = ×1.05; cover-up infers very-deep) |
| **Lightening (§8)** | ✅ Done | `lighteningLogicEngine.js` + `lighteningComparisonEngine.js` — customer % only if `comparison_eligible` |
| **Healing (§9)** | ✅ Done | `healingLogicEngine.js` — window + symptoms + progress; red flags override the window |
| **Implementation rules (§10)** | ✅ Done | Empty fields still calculate, raise uncertainty, set `needs_human_review`. Studio must confirm/correct price, sessions, lightening, healing |
| **Estimate confirmation** | ✅ Done | `PATCH /cases/:id/estimate-confirmation` — `offen` / `bestaetigt` / `angepasst` |
| **Photo_Standards** | ✅ Done | Failed/missing intake flags → review triggers; do not block calculation |
| **Customer vs studio** | ✅ Done | Customers never receive multipliers, weights, scores, or review-trigger internals |
| **Flow_Mapping events** | ✅ Done | Recalc on case create/update (incl. photos), aftercare submit, studio review, session complete (`lastSessionDate` = healing baseline) |

**Verify:** `npm run verify:examples` · `verify:lightening` · `verify:healing` · `verify:implementation`

### Configurable rules, multi-location studios & dynamic scheduling (2026-08-29)

No blocking period, appointment duration, or booking horizon is hardcoded any more. All of them are platform defaults that a studio can override, and both clients read them from the API instead of shipping their own copies.

| Area | Status | Notes |
|---|---|---|
| **`sperrfristen` config block** | ✅ Done | Studio-overridable blocking periods in days — `same_case_tage:49`, `cross_case_tage:28`, `uv_mittel_tage:21`, `uv_intensiv_tage:28`, `medikament_kurz_tage:14`, `medikament_retinoide_tage:180` |
| **`termin_einstellungen` config block** | ✅ Done | Studio-overridable scheduling — `behandlung_dauer_minuten:30`, `beratung_dauer_minuten:30`, `gruppen_dauer_minuten:90`, `buchung_horizont_tage:365`, `min_vorlaufzeit_stunden:0` |
| **`gruppen_punkte` (read-only)** | ✅ Done | `klein:1`, `mittelgross:2`, `gross:4` — platform-wide so a `gross` tattoo always fills the default 4-point cap and must be booked alone |
| **Three-layer merge** | ✅ Done | `configService.mergeNumericBlock` — static defaults → platform config → studio override; `PATCH` writes dotted paths so a partial patch cannot wipe siblings |
| **Cross-field invariants** | ✅ Done | `assertBlockInvariants` — `klein_max_cm2` **strictly** < `mittelgross_max_cm2` (equal thresholds make the medium tier unreachable), `gruppen_rabatt ≤ 1`, `uv_mittel_tage ≤ uv_intensiv_tage`, `buchung_horizont_tage ≥ 1` |
| **Lockout engine parameterised** | ✅ Done | `berechneAlleSperren({ sperrfristen })`; a block configured to `0` days is skipped; German messages interpolate the configured numbers |
| **Machine-readable lockout reasons** | ✅ Done | Each `sperren[]` entry now carries `kategorie` (`uv` · `medikament` · `cross_case` · `same_case`), `tage`, `case_name` — clients localize instead of printing the German `grund` |
| **Booking horizon + lead time** | ✅ Done | Availability returns `spaetestes`; `fruehestes` respects `min_vorlaufzeit_stunden`; bookings past the horizon are rejected |
| **Server-side appointment duration** | ✅ Done | `dauer_minuten` may be omitted — the studio's configured default for treatment / consultation / group applies |
| **Multi-location studios (`standorte`)** | ✅ Done | Each location has its own `oeffnungszeiten`, `oeffnungs_ausnahmen`, `pufferzeit_minuten`, `slot_interval_minuten`, `aktiv`; unset fields inherit from the studio |
| **Location-aware availability** | ✅ Done | `GET /cases/:id/availability?standort_id=…` scopes hours, slot grid, and occupancy; legacy appointments without a location still block every location |
| **Rooms + staff per location** | ✅ Done | `behandlungsraeume[].standort_id`, `mitarbeiter[].standort_id`, validated against existing locations; empty = available everywhere |
| **Last-used location** | ✅ Done | `GET /cases/:id/standorte` — flags where the customer last booked and was last treated; no approval needed to switch inside one studio |

**Exposure:** `sperrfristen`, `termin_einstellungen`, and `gruppen_punkte` all appear on `GET /config/public` and `GET /config/studio` (the latter also ships a `*_defaults` sibling per block for UI placeholders). New `configService` getters: `getEffectiveBookingConfig`, `getEffectiveSperrfristen`.

**Studio defaults centralised:** `config/studioDefaults.js` now owns `DEFAULT_DAY_HOURS`, `DEFAULT_SLOT_INTERVAL_MINUTEN:60`, `DEFAULT_PUFFERZEIT_MINUTEN:10`, `MIN/MAX_SLOT_INTERVAL_MINUTEN`, `MAX_PUFFERZEIT_MINUTEN` — previously inline literals in the model and `studioHours.js`.

### Zone-level treatment tracking (2026-08-29)

A zoned tattoo is one visual tattoo made of several independently treated zones. Every zone now carries its own measurements, photo, price, session log, fading baseline, and aftercare history.

| Area | Status | Notes |
|---|---|---|
| **Zone measured, not templated** | ✅ Done | `laenge_cm` + `breite_cm` are **required positive numbers**; `flaeche_cm2` is derived server-side and a client-supplied value is ignored. `flaeche_template` / `flaeche_modus` / `flaeche_manuell` and `ZONE_FLAECHE_TEMPLATE` removed |
| **Zone name required** | ✅ Done | `bezeichnung` is now a required non-empty trimmed string (was optional, defaulting to `''`) |
| **Per-zone price + session range** | ✅ Done | `refreshCaseEstimate` persists `preis`, `sitzungen_geschaetzt_min/max` onto each `CaseZone`; visible to customers |
| **Per-zone session numbering** | ✅ Done | Unique index widened from `{case, session_number}` to `{case, zonen_id, session_number}` — two zones can each have a session 1 |
| **`zonen_id` required for zone cases** | ✅ Done | `POST /sessions` rejects a missing zone on a zoned case and rejects a zone on a single-tattoo case; validated to belong to the case |
| **Sessions cannot change zone** | ✅ Done | `PATCH /sessions/:id` refuses to move a session between zones — delete and re-log it instead |
| **Per-zone progress rollup** | ✅ Done | `syncZoneSessionStats` writes `fortschritt_prozent`, `sitzungen_erledigt`, `letzte_sitzung` onto each zone |
| **Zone-scoped fading** | ✅ Done | Previous-session lookup filtered by `zonen_id`; `resolveZoneBaselinePhotoId` uses the zone's own intake photo as the session-1 baseline, never the whole-tattoo photo |
| **Per-zone aftercare** | ✅ Done | `zonen_id` on `NachsorgeCheck` (+ index), required for zone cases, validated, exposed, and filterable |
| **Zone filters** | ✅ Done | `GET /sessions?zonen_id=…`, `GET /nachsorge?zonen_id=…` |
| **Activity feed** | ✅ Done | Aftercare entries are prefixed with the zone (e.g. `Nachsorge-Check (Z001)`) so several checks on one tattoo stay distinguishable |
| **Density multiplier fixed** | ✅ Done | `ZONE_DICHTE_MULT` gained the `low`/`medium`/`high`/`very_high` keys the clients actually send — previously every zone silently fell back to ×1.0 |

**Migration required once:** `npm run migrate:session-zone-index` — creates the new unique index and drops the old `{case, session_number}` one. Idempotent. **Verify:** `npm run verify:zone-tracking`.

### Booking transparency, intake prefill & anamnesis signature (2026-08-29)

| Area | Status | Notes |
|---|---|---|
| **Earliest bookable date everywhere** | ✅ Done | The notice shown *before* the calendar now uses the same full lockout set as the calendar (same-case, cross-case, UV, medication, booked appointments) — the latest date always wins |
| **Availability hint always computed** | ✅ Done | `POST …/booking-precheck/preview` previously only returned `availability_hint` when the customer reported UV exposure, hiding same-case and cross-case blocks |
| **Real-time availability events** | ✅ Done | `sockets/availabilityEmit.js` — booking, cancelling, or logging a session re-broadcasts to **both** the customer and the studio, so a cross-case block that opens on case B appears without a manual refresh |
| **Intake prefill** | ✅ Done | `GET /cases/intake/prefill` — reuses the 16 person-level skin/lifestyle answers (`CARRY_OVER_INTAKE_FIELDS`) from the customer's most recent case. `skin_sun_zone` is deliberately excluded because it describes the treated area |
| **Per-case snapshot preserved** | ✅ Done | Prefill only seeds the form; each case still stores the answers that were valid when it was created, so history and session prediction stay traceable |
| **Second signature (anamnesis)** | ✅ Done | `POST /cases/:id/signature` accepts `anamnese_bestaetigt` (literal `true`), `anamnese_bestaetigung_text`, `anamnese_unterschrift_data`, stored separately in `unterschrift_anamnese` |
| **Separate signature image** | ✅ Done | `GET /cases/:id/signature/image?variant=anamnese`; stored as `signature-anamnese.jpg` alongside the leaflet signature |
| **Completion flag** | ✅ Done | `anamnesis_signature_complete` on case payloads and on `GET …/merkblatt` (`requirements`) |

**Socket events:** `customer:availability_changed` → room `availability:customer:{customerId}`, `studio:availability_changed` → room `availability:studio:{studioId}`. Payload `{ updated_at, reason, … }` with `reason` ∈ `appointment_created` · `appointment_cancelled` · `appointment_updated` · `session_created` · `session_updated`. Emission is fire-and-forget — a socket failure never fails the REST request.

### Live pricing preview + regression harness (2026-08-29)

| Area | Status | Notes |
|---|---|---|
| **Pricing preview endpoint** | ✅ Done | `POST /config/pricing/preview` — runs the real `pricingEngine` against **unsaved** `studio_pricing` values; never persists |
| **Ordered price breakdown** | ✅ Done | `breakdown.steps[]` = base price → each applied multiplier (with the `config_key` it came from and a running subtotal) → rounding → minimum-price floor |
| **Saved → draft delta** | ✅ Done | Runs the saved config as `baseline` alongside the draft and reports the CHF difference |
| **Config sanity check** | ✅ Done | `checkPricingConfig` flags a multiplier of `0` or less as an **error** (it collapses every price it touches) and implausibly high multipliers as a warning |
| **Multipliers name their source** | ✅ Done | `resolveColorMultiplier` / `resolveDepthMultiplier` return `{ key, value }` so a breakdown can say *which* setting produced ×1.4 |
| **API regression suite** | ✅ Done | `npm run regression` — 19 API suites + 3 Socket.io suites, ~136 checks; creates and cleans up its own fixtures so runs are idempotent |
| **Client static checks** | ✅ Done | `npm run regression:clients` — missing/duplicate translation keys, locale drift, hardcoded config values, route/navigation integrity across both client apps |
| **PDF report** | ✅ Done | `npm run regression:report` — renders the JSON results into `ELAYA_Regression_Test_Report.pdf` (requires `pdfkit`) |

**Verify:** `npm run verify:pricing-preview` (breakdown replays to the real price; a zero multiplier is reported) · `npm run verify:examples` still matches the Master Excel prices CHF 90 / 205 / 865.

## Permanent account deletion

`DELETE /customers/me` — customer only, **irreversible**, no grace period. Required by the App Store privacy policy: the customer must be able to erase their own data from inside the app without contacting support. Implemented in `services/accountDeletionService.js`; the controller is a thin wrapper.

| Area | Status | Notes |
|---|---|---|
| **Erased collections** | ✅ Done | `Customer`, `User`, `Case`, `CaseZone`, `Anamnesis`, `Session`, `Appointment`, `NachsorgeCheck`, `ChatConversation`, `ChatMessage`, `ActivityEvent`, `FileAsset`, `FileAccessAudit`, `RefreshToken`, `PasswordResetToken` — the Elaycoin ledger and case activity log are embedded documents and die with their parent |
| **Erased files** | ✅ Done | Every `FileAsset.storage_path`, both case signatures (`signature.jpg`, `signature-anamnese.jpg`, which are not tracked as FileAssets), and the now-empty `cases/{id}` and `sessions/{id}` directories |
| **File lookup is not customer-only** | ✅ Done | `FileAsset.customer` is optional, so assets are matched by `customer` **or** `case` **or** `session` — a customer-id-only query would leave staged uploads on disk |
| **Anonymized, not deleted** | ✅ Done | `ShopOrder` (accounting: Stripe intent, commission, Elaya share) and `StudioTransferRequest` (consent audit) keep their rows with the name, address and signature overwritten by `ANONYMIZED_NAME` |
| **Retained by configuration** | ✅ Done | `CrmNote` / `CrmTask` are studio-authored business records and are left in place |
| **Dangling refs are safe** | ✅ Done | The shop, CRM and admin formatters already guard `order.customer ? … : ''`, so a retained row renders with an empty name instead of throwing |
| **No transaction** | ✅ Done | Deployment targets a standalone `mongod`, where multi-document transactions are unavailable. Deletes run sequentially, leaf-first, with `Customer` and `User` **last**, so an interrupted run stays authenticated and the call is safely repeatable |
| **Credentials revoked** | ✅ Done | All refresh tokens for every device are hard-deleted, the path-scoped refresh cookie is cleared via `clearRefreshTokenCookie`, and live sockets for the user are force-disconnected (socket auth only runs at connect time) |
| **Fails closed afterwards** | ✅ Done | The access token stays cryptographically valid until it expires but `protect` rejects it with **401 `User no longer exists`**, so the client returns to the login screen |

**Verify:** `npm run verify:account-deletion` — seeds a synthetic customer with a row in every affected collection plus real files on disk, then asserts nothing personal survived, that another customer's data in the same studio is untouched, that retained records kept their accounting fields but lost their personal ones, and that a second run is a safe no-op (34 checks).

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
[2026-08-05] — Studio ↔ customer live chat: Socket.io + REST `/messaging` (Conversation/Message models)
[2026-08-19] — Master Excel engines: PriceFormula/Multipliers, session forecast + lifestyle composite, lightening + healing logic
[2026-08-19] — Human-in-the-loop: PATCH /cases/:id/estimate-confirmation, PATCH /nachsorge/:id/review, session lightening studio override
[2026-08-19] — Role-aware outputs: no customer multipliers; fading % only when comparison_eligible; skip KI on session 1
[2026-08-19] — Verifiers: npm run verify:examples | verify:lightening | verify:healing | verify:implementation
[2026-08-29] — Config blocks sperrfristen + termin_einstellungen (studio-overridable) + read-only gruppen_punkte
[2026-08-29] — Lockout engine parameterised: no hardcoded 49/28/21/28/14/180 days; sperren carry kategorie + tage for client-side localization
[2026-08-29] — Booking horizon (spaetestes) + min lead time; appointment durations default from studio config
[2026-08-29] — Multi-location studios: per-standort hours/exceptions/slot grid/buffer, rooms + staff per location, location-scoped availability
[2026-08-29] — GET /cases/:id/standorte — locations with last-booked / last-treated flags for the customer
[2026-08-29] — Zone tattoos measured: laenge_cm × breite_cm required, flaeche_cm2 derived, zone name required, per-zone price + session range persisted
[2026-08-29] — Per-zone sessions: unique index {case, zonen_id, session_number} + migrate:session-zone-index; zonen_id required for zone cases
[2026-08-29] — Per-zone fading baseline (zone intake photo) + per-zone progress rollup (syncZoneSessionStats)
[2026-08-29] — Per-zone aftercare: zonen_id on NachsorgeCheck + validation + filters; zone prefix in activity feed
[2026-08-29] — GET /cases/intake/prefill — reuse person-level skin/lifestyle answers from the customer's last case
[2026-08-29] — Second signature: anamnesis truthfulness stored separately (unterschrift_anamnese, variant=anamnese image)
[2026-08-29] — Real-time availability: customer:availability_changed + studio:availability_changed on booking/cancel/session
[2026-08-29] — POST /config/pricing/preview — live price breakdown (base → multipliers → final) + config sanity check
[2026-08-29] — Regression harness: npm run regression | regression:clients | regression:report (PDF)
[2026-08-29] — Fixes: invalid JSON → 400 (was 500), GDPR export zones, group booking dropped cases, zone photos dropped on case update, populated-ref access checks
[2026-08-31] — DELETE /customers/me — permanent account deletion across 16 collections + uploaded files; shop orders and transfer consents anonymized; npm run verify:account-deletion
```

---

## Project structure

```
backend/
├── config/
│   ├── constants.js       # Enums (roles, case status, appointment status, etc.)
│   ├── db.js              # MongoDB connection
│   ├── domainSourceOfTruth.js # IT_Clarifications §10 precedence + review principle
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
│   ├── seedDev.js         # Local dev fixtures only — blocked in production
│   ├── migrateSessionZoneIndex.js # One-time — per-zone session unique index
│   ├── verifyExcelExamples.js
│   ├── verifyLighteningLogic.js
│   ├── verifyHealingLogic.js
│   ├── verifyImplementationRules.js
│   ├── verifyAccountDeletion.js   # Permanent account deletion (DB + files + anonymization)
│   ├── verifyPricingPreview.js    # Live price breakdown + config sanity check
│   ├── verifyZoneTracking.js      # Per-zone sessions / aftercare / progress
│   ├── verifyCaseAvailability.js  # Cross-case recalculation of earliest date
│   ├── verifyAvailabilitySocket.js
│   ├── verifyStudioAvailabilitySocket.js
│   └── regression/        # Full platform regression harness
│       ├── run.js         # Orchestrator — npm run regression
│       ├── runner.js      # Assertion + structured-result harness
│       ├── httpClient.js  # HTTP client with cookie jar (refresh-token flows)
│       ├── apiSuites.js   # 19 API suites
│       ├── socketSuites.js # Connection, availability fan-out, messaging
│       ├── checkClients.mjs # Static i18n / hardcoded-value checks on both clients
│       └── buildReport.mjs  # Results → PDF (pdfkit)
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
│   ├── accountDeletionService.js # Permanent account deletion (DELETE /customers/me)
│   ├── emailService.js          # Password reset emails (console / SMTP)
│   ├── fileAccessService.js     # FileAsset permissions + linking
│   └── fileStorageService.js    # Upload paths, unlink, recursive directory removal
├── utils/
│   ├── accessHelpers.js         # Shared Case Layer + role/access checks (cases, sessions, customers)
│   ├── anamnesisEngine.js       # Medical anamnesis ampel + klaerung-aware effective status
│   ├── ApiError.js
│   ├── asyncHandler.js
│   ├── bookingPrecheckEngine.js # PS_01 validation (UV/meds/KO/wiederholungen)
│   ├── bookingPrecheckApply.js  # Persist PS_01 side effects on appointment book
│   ├── generateCaseId.js
│   ├── generateTokenAndSetCookies.js
│   ├── lockoutEngine.js         # berechneAlleSperren — configurable sperrfristen, UV/meds, horizon + lead time
│   ├── medicalFlagHelpers.js    # Worst medical flag aggregation for CRM/customers
│   ├── passwordReset.js         # Token issue/verify + portal-scoped reset
│   ├── pagination.js            # page/limit parsing for list endpoints
│   ├── elaycoinEngine.js        # vergebeElaycoins, zieheElaycoinsAb, expiry
│   ├── configService.js         # platform_config + studio_pricing helpers
│   ├── pricingEngine.js         # Excel PriceFormula + multipliers (internal)
│   ├── sessionPredictionEngine.js
│   ├── lifestyleCompositeEngine.js
│   ├── lighteningLogicEngine.js
│   ├── lighteningComparisonEngine.js
│   ├── lighteningSessionService.js
│   ├── healingLogicEngine.js
│   ├── photoStandards.js        # Photo_Standards intake flags
│   ├── engineReview.js          # needs_human_review envelope
│   ├── plausibilityCheck.js     # Excel §7 examples
│   ├── groupBooking.js          # Size points (gruppen_punkte) + group discount
│   ├── studioHours.js           # Opening hours + per-standort schedule resolution
│   └── sessionHelpers.js        # Per-zone session_number + case/zone stats sync
├── sockets/
│   ├── index.js                 # Socket.io server — JWT auth, rooms
│   ├── availabilityEmit.js      # customer/studio:availability_changed fan-out
│   └── studioScheduleEmit.js    # studio:schedule_updated
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

Studio web (`elaya-frontend`) and customer app (`elaya-mobile`) both talk to this API at `/api/v1`. See those READMEs for local `VITE_API_URL` / `EXPO_PUBLIC_BASE_URL`.

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
| `GET` | `/api/v1/cases/intake/prefill` | Bearer | Person-level skin/lifestyle answers from the customer's last case — `customer_id` (studio/admin), `exclude_case_id` |
| `GET` | `/api/v1/cases/:id/availability` | Bearer | Booking calendar — blocked days, `fruehestes`, `spaetestes`; optional `standort_id` |
| `GET` | `/api/v1/cases/:id/standorte` | Bearer | Studio locations for this case + last-booked / last-treated flags |
| `POST` | `/api/v1/cases/pricing/preview` | Bearer | Price + session preview from intake (no case id) — customer sees AB only |
| `GET` | `/api/v1/cases/:id/pricing` | Bearer | Price estimate — customer AB only; studio sees breakdown + `needs_human_review` |
| `PATCH` | `/api/v1/cases/:id/estimate-confirmation` | Studio / Admin | Confirm (`bestaetigt`), adjust (`angepasst`), or re-open (`offen`) the estimate |

**Zones on `POST`/`PATCH /cases`:** each zone requires `bezeichnung`, `laenge_cm`, `breite_cm`, and `foto_url` (a staging file id uploaded with `slot=zone`). `flaeche_cm2` is derived server-side. Responses add `preis`, `sitzungen_geschaetzt_min/max`, `sitzungen_erledigt`, `letzte_sitzung`, `fortschritt_prozent` per zone.

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
| `POST` | `/api/v1/sessions` | Bearer (studio/admin) | Record treatment session — `zonen_id` **required** for zone cases |
| `GET` | `/api/v1/sessions` | Bearer | List sessions (customer = read-only view) — **paginated**, optional `zonen_id` |
| `GET` | `/api/v1/sessions/:id` | Bearer | Get session details |
| `PATCH` | `/api/v1/sessions/:id` | Bearer (studio/admin) | Update protocol / complete draft — cannot move a session to another zone |

**Per-zone numbering:** `session_number` is unique per `{case, zonen_id}`, so each zone of a tattoo has its own session 1, 2, 3 … Zone sessions get `session_id` `s<n>-<zonen_id>-<caseTail>`. Run `npm run migrate:session-zone-index` once on an existing database.

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

**Pricing:** Customers see displayed price/session range only (no multipliers, weights, or review triggers). Until the studio confirms (`estimate_confirmation`), the engine snapshot is shown; after confirm/adjust, confirmed values win. Studio still sees the calculated snapshot.

### Nachsorge (aftercare)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/nachsorge/photo-check` | Bearer | Stage 1 — photo-only AI ampel |
| `POST` | `/api/v1/nachsorge/check` | Bearer | Stage 2 — persist healing assessment; also runs lightening on latest session |
| `GET` | `/api/v1/nachsorge` | Bearer | List checks (customer = own; studio = studio-scoped) |
| `GET` | `/api/v1/nachsorge/:id` | Bearer | Check detail (role-scoped fields) |
| `PATCH` | `/api/v1/nachsorge/:id/review` | Studio / Admin | Confirm or correct `healing_status` + notes |

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
| `GET` | `/api/v1/config/public` | Bearer (all roles) | Group booking sizes + points, `sperrfristen`, `termin_einstellungen`, Elaycoin display limits |
| `GET` | `/api/v1/config/platform` | Admin | Full platform config (Elaycoin, finance, group booking, blocking periods, appointments) |
| `PATCH` | `/api/v1/config/platform` | Admin | Update platform config (partial) |
| `GET` | `/api/v1/config/studio` | Studio staff/admin | Own studio pricing + Elaycoin / booking overrides (each block with a `*_defaults` sibling) |
| `PATCH` | `/api/v1/config/studio` | Studio admin | Update own `studio_pricing`, `elaycoin_studio_cfg`, `coin_wert`, `gruppen_groessen`, `sperrfristen`, `termin_einstellungen` |
| `POST` | `/api/v1/config/pricing/preview` | Studio / Admin | Live price breakdown for **unsaved** pricing values — never persists |
| `GET` | `/api/v1/config/studios/:studioId` | Admin | Studio config by ID |
| `PATCH` | `/api/v1/config/studios/:studioId` | Admin | Update any studio config |

**Platform defaults (client handoff):** `coinWert:0.10`, `minWert:0.05`, `maxWert:0.20`, `deckelProzent:20`, `verfallMonate:12`, `grundgebuehr:149`, `transaktionsProzent:3`, `zahlungszielTage:30`, `gruppen_groessen:{ klein_max_cm2:50, mittelgross_max_cm2:150, max_punkte:4, gruppen_rabatt:0.15 }`.

**Studio-overridable numeric blocks** (`gruppen_groessen`, `sperrfristen`, `termin_einstellungen`) merge as **static defaults → platform config → studio override**, so a studio only stores the keys it actually changed. Patches are written as dotted paths, so sending one key never wipes its siblings.

| Block | Keys (defaults) |
|---|---|
| `gruppen_groessen` | `klein_max_cm2:50`, `mittelgross_max_cm2:150`, `max_punkte:4`, `gruppen_rabatt:0.15` |
| `sperrfristen` | `same_case_tage:49`, `cross_case_tage:28`, `uv_mittel_tage:21`, `uv_intensiv_tage:28`, `medikament_kurz_tage:14`, `medikament_retinoide_tage:180` |
| `termin_einstellungen` | `behandlung_dauer_minuten:30`, `beratung_dauer_minuten:30`, `gruppen_dauer_minuten:90`, `buchung_horizont_tage:365`, `min_vorlaufzeit_stunden:0` |
| `gruppen_punkte` *(read-only)* | `klein:1`, `mittelgross:2`, `gross:4` |

`gruppen_punkte` is intentionally **not** editable: `gross` equals the default `max_punkte`, which is what makes a large tattoo bookable only on its own. Studios adjust the cm² thresholds instead.

**Live pricing preview:** `POST /config/pricing/preview` with `{ preset_id?, case_input?, studio_pricing?, studio_id? }` returns `{ live, baseline, delta, config_check, presets }`. `live.breakdown.steps[]` walks base price → each multiplier (naming the `config_key` it came from, with a running subtotal) → rounding → minimum-price floor, so a studio can see exactly which of its own settings moved the price. `config_check.issues[]` flags values that break the maths — a multiplier of `0` is an `error` because it collapses every price it touches.

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
- `standorte[]` — `{ id, name, strasse, plz, ort, land, aktiv, oeffnungszeiten, oeffnungs_ausnahmen[], pufferzeit_minuten, slot_interval_minuten }`
- `behandlungsraeume[]` — `{ id, name, farbe, aktiv, laser_brand, laser_model, standort_id }`
- `mitarbeiter[]` — `{ id, vorname, nachname, rolle, raum_id, aktiv, user_id, standort_id }` (roster only; login invite flow post-M2)
- `pufferzeit_minuten` — buffer after appointments (0–120)

**PATCH notes:**

- `profile`, `oeffnungszeiten`, and `pufferzeit_minuten` are partial merges.
- `standorte`, `behandlungsraeume`, and `mitarbeiter` **replace the full array** when sent — include existing items you want to keep.
- `mitarbeiter[].raum_id` must reference a room `id` from the current roster (validated on save).
- `behandlungsraeume[].standort_id` / `mitarbeiter[].standort_id` must reference an existing location; leave empty to make the resource available at every location.
- Staff roles: `Studiobetreiber`, `Laser-Therapeutin`, `Empfang`, `Andere`.

**Locations (`standorte`):** a location inherits every unset field from the studio, so a branch that shares the studio's hours only needs a name and address. `slot_interval_minuten` accepts `15 | 30 | 45 | 60` or `null` (inherit). Set `aktiv: false` to keep a location on record without offering it for booking — inactive locations are hidden from `GET /studios/public` and from `GET /cases/:id/standorte`.

**Location-aware booking:** `POST /appointments` resolves `standort_id` against the studio. A studio with exactly one active location gets it assigned automatically; a customer booking at a multi-location studio without one gets `400 standort_id is required — please choose a location`. Switching location inside the same studio needs no request or approval.

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
| `npm run verify:examples` | Master Excel §7 price/session fixtures |
| `npm run verify:lightening` | LighteningLogic_Master + §8 fixtures |
| `npm run verify:healing` | HealingLogic_Master + §9 fixtures |
| `npm run verify:implementation` | §10 source-of-truth / review / customer-hide checks |
| `npm run verify:session-preview` | Session prediction preview breakdown |
| `npm run verify:pricing-preview` | Live price breakdown replays to the engine's price; config sanity check |
| `npm run verify:zone-tracking` | Per-zone session logging, aftercare, and progress rollup (needs the API running) |
| `npm run verify:account-deletion` | Permanent account deletion erases every collection and file, anonymizes retained records, and is idempotent |
| `npm run migrate:session-zone-index` | **One-time** — widen the session unique index to `{case, zonen_id, session_number}` |
| `npm run regression` | Full API + Socket.io regression suite (needs the API running) |
| `npm run regression:clients` | Static checks on both client apps — i18n keys, locale drift, hardcoded config |
| `npm run regression:report` | Render the last regression results into a PDF report |

Scripts without an npm alias — run with `node scripts/<name>.js`:

| Script | Description |
|---|---|
| `verifyCaseAvailability.js` | Proves one case's earliest bookable date moves when another case of the same customer is booked |
| `verifyAvailabilitySocket.js` | Books and cancels over HTTP, asserts `customer:availability_changed` arrives on a real socket |
| `verifyStudioAvailabilitySocket.js` | Same with two clients — asserts `studio:availability_changed` reaches a studio-only socket |

### Regression suite

```bash
npm run dev                  # API must be running
npm run regression           # 19 API suites + 3 realtime suites
npm run regression:clients    # static i18n / hardcoded-value checks on frontend + mobile
npm run regression:report     # → ELAYA_Regression_Test_Report.pdf
```

The suite creates a throwaway customer, exercises the full customer journey (anamnesis → both signatures → booking pre-check → booking → session → aftercare), and deletes its own fixtures, so it is safe to re-run. Configure the target with `REGRESSION_BASE_URL` (default `http://localhost:4000`).

Coverage: health & discovery, auth & authorization, configuration, customers, cases, availability & blocking periods, anamnesis & signatures, appointments, group booking, sessions, studio dashboard, admin dashboard, shop, messaging, aftercare & fading, files, studio transfers, Elaya chat, and input validation / hardening.

---

## Conventions

- **API/DB fields:** German names from client handoff (`DEVELOPER-HANDOFF-EN.md`)
- **Internal code:** English (controllers, middleware, file names)
- **Validation:** Zod schemas in `validators/`
- **Errors:** `{ success: false, message, errors? }`
- **Success:** `{ success: true, data?, message? }`

---

## Related docs

- `../elaya-frontend/README.md` — Studio / admin web
- `../elaya-mobile/README.md` — Customer app
- `../DEVELOPER-HANDOFF-EN.md` — Full platform spec and field definitions
- `../ELAYA-DOCS-FOR-CLIENT.pdf` — Milestones and architecture
- `../masterExcelFile_EN.xlsx` — Leading domain reference (IT_Clarifications, engines, Photo_Standards, Flow_Mapping)
- `config/fieldReference.js` — Developer field name cheat sheet (local only, not in git)

---

## Updating this README

When you finish a feature, update:

1. **Current progress** table (status + notes)
2. **Changelog** (date + one line)
3. **API endpoints** section if new routes were added
4. **Last updated** date at the top

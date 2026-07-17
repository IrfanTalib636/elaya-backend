# Elaya Customer Mobile App — Developer Guide

**Audience:** iOS / native mobile developers  
**Last updated:** 17 July 2026  
**Prototype reference:** `inkderm-prototype/public/customer/index.html` (binding process reference)  
**Backend reference:** `backend/README.md` · Swagger UI `{BASE}/api/v1/docs`  
**Studio dashboard:** mirrors the same case/anamnesis/ampel/booking data (Phases A–E)

This document describes **what the customer app should do**, screen-by-screen, and which **REST APIs** to call. Processes must match the prototype 1:1 except for design and later features.

---

## Table of contents

1. [Architecture rules](#1-architecture-rules)
2. [App shell](#2-app-shell)
3. [Bottom navigation (6 tabs)](#3-bottom-navigation-6-tabs)
4. [Elaya AI assistant (FAB)](#4-elaya-ai-assistant-fab)
5. [Authentication & registration](#5-authentication--registration)
6. [Home tab](#6-home-tab)
7. [Tattoo case wizard (TC_01–TC_09)](#7-tattoo-case-wizard-tc_01tc_09)
8. [Case detail](#8-case-detail)
9. [Booking flow](#9-booking-flow)
10. [Nachsorge (aftercare check)](#10-nachsorge-aftercare-check)
11. [Verlauf (session history)](#11-verlauf-session-history)
12. [Shop (ElayShop)](#12-shop-elayshop)
13. [Studios (discover)](#13-studios-discover)
14. [Profile](#14-profile)
15. [PMU case (7-step wizard)](#15-pmu-case-7-step-wizard--prototype-parity)
16. [Medical flow — prototype parity (Phases A–E)](#16-medical-flow--prototype-parity-phases-ae)
17. [API reference — ready vs planned](#17-api-reference--ready-vs-planned)
18. [Suggested integration order](#18-suggested-integration-order)

---

## 1. Architecture rules

| Rule | Detail |
|------|--------|
| **Backend only** | Mobile app never calls Anthropic/OpenAI directly. All AI goes through Elaya VPS. |
| **Base URL** | Production: your deployed VPS URL + `/api/v1` (confirm with backend team). |
| **Auth** | JWT Bearer token from `POST /auth/login`. Refresh via cookie on `POST /auth/refresh`. |
| **Role** | Customer users have `role: customer`. APIs auto-scope data to the logged-in customer. |
| **Language** | UI copy is German (de-CH). API field names mix German (`vorname`, `geburtsdatum`) and English (`status`, `caseId`). |
| **Photos** | Sensitive health data (DSG/GDVO). Phase A: store on VPS/MongoDB only. Phase B: optional AI analysis after legal consent. |
| **Pricing** | Customers see **AB price estimate only**. Internal studio pricing fields are stripped from customer responses. |

---

## 2. App shell

```
┌─────────────────────────────────────┐
│  Header: Logo · Elaycoins · Profile │
├─────────────────────────────────────┤
│                                     │
│           Main content              │
│                                     │
│                          [Elaya AI] │  ← floating FAB (not a tab)
├─────────────────────────────────────┤
│ 🏠  🔍  ➕  🛍️  💬  👤              │  ← 6-tab bottom bar
└─────────────────────────────────────┘
```

| Element | Prototype ID | Behavior |
|---------|--------------|----------|
| Header | top bar | Elaya logo, Elaycoin balance badge, shortcut to profile |
| Bottom tab bar | `#tab-bar` | Always visible when logged in |
| Elaya AI FAB | `#elaya-btn` | Green wave button, bottom-right **above** tab bar |
| Elaya AI panel | overlay | Slide-up chat — **not** the Chat tab |

**Screens without tab bar:** Registration, login, full-screen wizards (new case, booking, nachsorge).

---

## 3. Bottom navigation (6 tabs)

| # | Tab | Icon | Screen | What it does |
|---|-----|------|--------|--------------|
| 1 | **Home** | 🏠 | `home` | Dashboard: cases, lockouts, booking CTAs, quick actions |
| 2 | **Studios** | 🔍 | `discover` | Find studios (search + map placeholder in prototype) |
| 3 | **Neu** | ➕ | *(action)* | Starts **new tattoo case** wizard — does **not** switch tab |
| 4 | **Shop** | 🛍️ | `shop` | ElayShop catalog, cart, checkout |
| 5 | **Chat** | 💬 | `chat` | **Studio live chat** (human staff) — prototype: placeholder |
| 6 | **Profil** | 👤 | `profile` | Profile, my studio, studio switch, data export, logout |

### Chat tab vs Elaya AI — do not merge

| Feature | Entry point | Purpose |
|---------|-------------|---------|
| **Elaya assistant** | FAB (floating button) | AI helper: lockouts, booking help, case context |
| **Chat tab** | Bottom nav | Future **studio ↔ customer** messaging |
| **Nachsorge AI** | Home / case detail | Photo + symptom check after treatment |

---

## 4. Elaya AI assistant (FAB)

**Trigger:** Tap floating Elaya button on any main screen.

**Context injected server-side (prototype: `buildAssistantContext()`):**
- Active cases, session counts, removal %
- Next appointment, lockout dates (`sperren`, `fruehestes`)
- Anamnesis ampel (grün / orange / rot)
- Elaycoin balance (optional)

**Assistant rules (from prototype):**
- Explain lockout rules; never override system-calculated dates
- No medical diagnosis; escalate emergencies to studio / 144
- Can suggest actions: book appointment, open Verlauf, contact studio

**API (planned — not live yet):**

```
POST /api/v1/chat
Authorization: Bearer <token>

{
  "message": "Wann kann ich den nächsten Termin buchen?",
  "case_id": "<optional MongoDB case id>"
}
```

```json
{
  "success": true,
  "data": {
    "reply": "...",
    "suggested_actions": ["termin_buchen", "verlauf"]
  }
}
```

Until this endpoint exists, show a “coming soon” state or a static FAQ — **do not** embed API keys in the app.

---

## 5. Authentication & registration

### 5.1 Registration flow

The prototype collects profile fields only. **Production adds a studio picker** before submit.

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────────────┐
│ Load studios │ ──► │ User picks studio   │ ──► │ POST register/customer   │
│ (public API) │     │ (keep studio_code)  │     │ with studio_code         │
└──────────────┘     └─────────────────────┘     └──────────────────────────┘
```

**Step 1 — Studio list (no auth):**

```
GET /api/v1/studios/public
```

Response includes only **`aktiv`** studios: `studio_code`, `firma`, address, `standorte[]`.

**Step 2 — Register:**

```
POST /api/v1/auth/register/customer
```

| Field | Required | Notes |
|-------|----------|-------|
| `vorname`, `nachname` | Yes | |
| `email`, `password` | Yes | |
| `telefon` | Yes | |
| `geburtsdatum` | Yes | **Must be 18+** — validate client-side |
| `strasse`, `plz`, `ort`, `land` | Yes | |
| `studio_code` | Yes | From selected studio, e.g. `INKFREE` |

**Step 3 — Login:**

```
POST /api/v1/auth/login
{ "email", "password", "portal": "customer" }
```

Store `accessToken`. Use `GET /auth/me` for profile + `customer_id`.

### 5.2 Forgot / reset password

```
POST /api/v1/auth/forgot-password   { "email", "portal": "customer" }
POST /api/v1/auth/reset-password    { "token", "password" }
```

Deep link from email opens reset screen in app.

---

## 6. Home tab

### 6.1 Content blocks

1. **Greeting** — “Hallo {vorname}”
2. **Conflict alerts** — if rescheduled session broke an existing appointment lockout
3. **Case cards** — one per active case (see below)
4. **Empty state** — CTA: new Tattoo-Case or PMU-Case
5. **Elaycoins teaser** — balance + recent transactions
6. **Schnellzugriff** — 2×2 grid: Nachsorge · Termin · Studio Chat · Shop
7. **Group booking banner** — if customer has ≥2 bookable cases

### 6.2 Case card (each case)

| UI element | Data source |
|------------|-------------|
| Title, `#caseId`, body region | `GET /cases` |
| Session count, removal % | Case + `GET /sessions?case_id=` |
| Ampel badge | Case `medical_flag_level` / anamnesis `ampel_status` (effective after studio klaerung) |
| Lockout banner | `GET /cases/:id/availability` → `sperren`, `fruehestes` |
| Booking row | Availability + next `GET /appointments` |
| Nachsorge / Verlauf buttons | Navigate to sub-flows |

**Booking row states:**

| State | UI copy (prototype) |
|-------|---------------------|
| No sessions yet | “Kostenloses Beratungsgespräch buchen” |
| Lockout active | “Frühestens ab {date}” / “Jetzt vormerken” |
| Appointment exists | Show next date + standort |
| Ready to book | “Nächsten Termin buchen” |
| UV/med block | “TERMIN NEU ANSETZEN” (must rebook another case first) |

**APIs:**

```
GET /api/v1/cases?page=1&limit=20
GET /api/v1/cases/:id/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/v1/appointments?case_id=:id
GET /api/v1/elaycoins/me
GET /api/v1/auth/me
```

---

## 7. Tattoo case wizard (TC_01–TC_09)

Prototype progress: **9 steps** — `TC_01`…`TC_06` intake, then anamnese summary (`TC_07`), Merkblatt (`TC_08`), signature (`TC_09`).  
After step 6 the app shows a **KI pricing result screen** (between intake and medical).  
UI may group summary + Merkblatt + signature visually; API calls below are what matter.

### Overview

| Step | Code | Title | Save strategy |
|------|------|-------|---------------|
| 1 | TC_01 | Tattoo basics | Create draft case `POST /cases` |
| 2 | TC_02 | Properties / zones | `PATCH /cases/:id` |
| 3 | TC_03 | Skin & risk | `PATCH /cases/:id` |
| 4 | TC_04 | Lifestyle | `PATCH /cases/:id` ⚠️ fields TBD |
| 5 | TC_05 | Treatment goal | `PATCH /cases/:id` |
| 6 | TC_06 | Intake photos | `POST /files/staging` → file IDs on `POST/PATCH /cases` |
| — | KI | Session + price estimate | `GET /cases/:id/pricing` |
| 7 | TC_07 | Medical anamnese (19 Q) + live ampel | `POST …/anamnesis/preview` then `PUT …/anamnesis` |
| 8 | TC_08–09 | Summary + Merkblatt + signature | `GET …/merkblatt` → `POST …/signature` |

### Step 1 — Tattoo basics (`TC_01`)

| Field | Prototype | API field |
|-------|-----------|-----------|
| Bezeichnung | title | `tc_title` |
| Körperregion | body map | `bodyLabel` |
| Multi-zone mode | yes/no | `zonen_aktiv` |
| Seite | links/rechts/mitte | ⚠️ extend API |
| Tattoo-Alter | years | `tc_age_years` |
| Tattoo-Typ | professional / amateur / … | `tc_type` |
| Cover-up | yes/no/partial | `tc_coverup` |
| Prior treatments | yes/no + count | ⚠️ extend API |

**On complete:** `POST /api/v1/cases` with collected fields. Keep returned `id` and `caseId` (e.g. `#UNT-001`).

### Step 2 — Tattoo properties (`TC_02`)

**Single tattoo:** colors[], density, saturation, shading, linework, size L×W cm²  
**Multi-zone (`zonen_aktiv: true`):** 2–8 zones, each with colors, area, optional photo

| API field | Status |
|-----------|--------|
| `tc_colors_present` | ✅ |
| `tc_size_length`, `tc_size_width` | ✅ |
| `zonen[]` (max 8) | ✅ partial — `bezeichnung`, `koerperstelle`, `farben`, `dichte`, `flaeche_cm2`, `foto_url` |
| saturation, shading, linework | ⚠️ not in validator yet |

### Step 3 — Skin & risk (`TC_03`)

| Field | API field |
|-------|-----------|
| Fitzpatrick I–VI | `skin_fitzpatrick` ✅ |
| Hyperpigmentation risk | ⚠️ TBD |
| Keloid risk | ⚠️ TBD |
| Sun exposure zone | ⚠️ TBD |

### Step 4 — Lifestyle (`TC_04`)

Smoking, alcohol, activity, sleep, stress, height, weight, hydration, nutrition — used by pricing engine in prototype. **Backend intake fields for these are not fully exposed yet.** Coordinate with backend before wiring UI.

### Step 5 — Goal (`TC_05`)

| Field | API field |
|-------|-----------|
| `full_removal` / `partial_fade` / `coverup_lightening` | `goal_target` ✅ |
| Notes | ⚠️ TBD |

### Step 6 — Intake photos (`TC_06`)

- Hauptfoto (recommended), detail photo, marker photo (optional)
- Quality checklist (5 items) — client-side validation only
- Multi-zone: optional photo per zone (`zonen[].foto_url` = file asset ID)

**Production flow (studio + mobile):**

1. `POST /api/v1/files/staging` — multipart: `file`, `slot` (`main` | `detail` | `marker` | zone slot), optional `customer_id`
2. Response: `{ id }` — private file asset ID (not a public URL)
3. On case save: send IDs in `photo_intake_main`, `photo_intake_detail`, `photo_marker`, or zone `foto_url`
4. Display: `GET /api/v1/files/{id}/content` (Bearer) — returns image bytes; use blob URL in app

**UI best practice:** square 1:1 thumbnails with `object-cover`; full-screen lightbox with `object-contain` (preserve portrait phone photos). Store originals — do not crop on upload.

**Security:** no public URLs; audit log on access. Staging files expire after 24h if not linked to a case.

### KI result screen (after step 6)

Shows:
- Estimated sessions (min–max)
- Timeframe text
- **AB price** (customer-facing estimate)

```
GET /api/v1/cases/:id/pricing
```

Customer response hides internal breakdown. CTA: “Weiter → Medizinische Anamnese”.

### Step 7 — Medical anamnese (`TC_07`)

**Prototype rule (exact):** Red/orange does **not** block finishing the wizard. Customer must answer all questions; they continue to summary → Merkblatt → signature. Studio is flagged and will contact / klaeren later.

| Behavior | Detail |
|----------|--------|
| Questions | ~19 keys (skin, chronic, meds, pregnancy, KO fields, …) |
| Live ampel | On each answer change, call **preview** (do not persist yet) |
| Inline hints | Orange/red hint text under triggered questions (same copy as prototype) |
| Submit gate | All required answers filled — **not** “ampel must be green” |
| After submit | Show summary: green OK / orange “Hinweise” / red “Studio meldet sich” — then **Weiter zur Unterschrift** |

```
POST /api/v1/cases/:id/anamnesis/preview
Body: { "antworten": { "<question_key>": <value>, ... } }
→ { ampel_status, orange_fragen, rote_fragen, ... }

PUT  /api/v1/cases/:id/anamnesis
Body: { "antworten": { ... } }
→ persists answers; sets anamnesis_complete; may set studio_freigabe (Stufe 2)
```

**Do not** call klaerung APIs from mobile — those are **studio-only**. Original answers stay immutable; studio klaert flags without rewriting customer answers.

### Step 8–9 — Summary, Merkblatt (`TC_08`), signature (`TC_09`)

1. Read-only summary of ampel + flagged questions (from PUT response or GET anamnesis)
2. `GET …/merkblatt` — show leaflet; require scroll/read confirm (`merkblatt_gelesen: true`)
3. Signature canvas → PNG/JPEG data URL
4. `POST …/signature` — **not** `PATCH /cases` for sign-off
5. Backend finalizes draft → typically `status: pending` (studio pipeline), not `active`
6. Optional client-side PDF: pass `merkblatt_pdf` if you generate one; server storage of PDF is optional

```
GET  /api/v1/cases/:id/merkblatt?lang=de
POST /api/v1/cases/:id/signature
{
  "merkblatt_gelesen": true,
  "bestaetigung_text": "Ich bestätige …",
  "unterschrift_data": "data:image/png;base64,...",
  "merkblatt_pdf": null
}
```

Prerequisite: anamnesis must be completed (`PUT` first). Re-sign by customer → `409` if already signed.

---

## 8. Case detail

Deep view for one case. Opened by tapping a case card on Home.

| Section | Content |
|---------|---------|
| Header | Title, `#caseId`, ampel (`medical_flag_level`), status |
| Intake summary | Steps 1–5 fields + intake photos (via file IDs → `/files/{id}/content`) |
| Booking block | Book / reschedule / cancel (treatment needs PS_01) |
| Sperrfrist | Active lockouts from availability API |
| Verblassungs-Reise | Session progress photos + fading % |
| Documents | Merkblatt / signature status |
| Actions | Nachsorge, Verlauf, Studio chat |

**APIs:**

```
GET /api/v1/cases/:id
GET /api/v1/cases/:id/availability
GET /api/v1/sessions?case_id=:id
GET /api/v1/appointments?case_id=:id
```

---

## 9. Booking flow

Multi-step wizard (`screenBooking` in prototype). Matches **PS_01** end-to-end.

| Step | Screen | Logic |
|------|--------|-------|
| 1 | Case picker | List customer cases (signed / bookable) |
| 2 | Visit type | **Beratung only** (`consultationOnly: true`) **or** treatment |
| 3 | Standort | If studio has multiple `standorte` |
| 4 | PS_01 pre-check | Load form → answer → preview → then calendar |
| 5 | Calendar | Month view; respect `fruehestes` / sperren |
| 6 | Time slot | Pick time within `frei_fenster` |
| 7 | Confirm | Summary + optional group booking |

### PS_01 — full flow (treatment bookings)

**Beratung only:** skip PS_01. No `booking_precheck` required.

**Treatment (and treatment reschedule):** customer must send `booking_precheck` on `POST/PATCH /appointments`.

```
GET  /api/v1/cases/:id/booking-precheck
→ form schema: UV options, medication groups, KO re-checks, wiederholungen list

POST /api/v1/cases/:id/booking-precheck/preview
Body: {
  "consultation_only": false,
  "pre_session": {
    "uv_exposition": "mittel",
    "medikamente": ["antibiotika"],
    "medikament_datum": "2026-07-01"
  },
  "ko_answers": {
    "schwanger": "changed",
    "akute_erkrankung": "still"
  },
  "wiederholungen": {
    "F5": { "aktuell_gleich": true, "aenderung": "" }
  },
  "wiederholungen_confirmed": true,
  "ko_signature": { "unterschrift_data": "data:image/png;base64,..." }
}
→ { can_proceed, blocks, requires_ko_signature, availability_hint, ... }
```

| Part | When | Customer action |
|------|------|-----------------|
| **UV + meds** | Always (treatment) | `uv_exposition`, `medikamente[]`, optional `medikament_datum` |
| **KO re-check** | Prior anamnesis KO still flagged | Each key: `changed` or `still` (`still` → block book) |
| **Wiederholungen** | Orange/red flags from anamnesis | Confirm still true or describe change |
| **KO signature** | When preview says `requires_ko_signature` | Extra canvas before confirm |

Prototype: red anamnesis does **not** forbid booking; KO points are re-asked at booking. If still active → block with message.

Then load calendar (UV/meds also extend lockouts):

```
GET /cases/:id/availability?from=&to=&uv_exposition=mittel&medikamente=antibiotika&medikament_datum=2026-07-01
```

### Lockout rules (must match backend)

| Rule | Days |
|------|------|
| Same case after session | 49 |
| Cross-case (other tattoos) | 28 |
| UV mittel / intensiv | 21 / 28 from check |
| Meds (antibio/antidep / retinoide) | 14 / 180 from intake date |
| Consultation only | Bypasses treatment lockouts + PS_01 |

**Book treatment:**

```
POST /api/v1/appointments
{
  "case_id": "...",
  "date": "2026-07-20T08:00:00.000Z",
  "time": "10:00",
  "consultationOnly": false,
  "standort_name": "Aesch BL",
  "dauer_minuten": 30,
  "booking_precheck": {
    "pre_session": { "uv_exposition": "keine", "medikamente": [] },
    "ko_answers": {},
    "wiederholungen": {},
    "wiederholungen_confirmed": true
  }
}
```

**Book Beratung only:**

```
POST /api/v1/appointments
{
  "case_id": "...",
  "date": "...",
  "time": "10:00",
  "consultationOnly": true
}
```

**Reschedule / cancel:**

```
PATCH /api/v1/appointments/:id
{ "date": "...", "time": "...", "booking_precheck": { ... } }   // treatment reschedule
{ "status": "storniert" }
```

Cancel/reschedule **<24h before** → Elaycoin malus (`kurzfristige_stornierung`, −80 coins). Prototype also shows CHF fee messaging — confirm product copy with studio; coin rule is on backend.

**Group booking:** `gruppen_termin: true`, `gruppen_cases: ["caseId2"]` (same customer, 2+ cases). PS_01 applies once for treatment group book.
## 10. Nachsorge (aftercare check)

Opened from Home quick action or case detail.

### Prototype flow (2-stage AI)

1. Select case + upload healing photo + last session date
2. **Stage 1:** Photo analysis → `foto_status` (grün/orange/rot)
3. **Stage 2:** Symptom chips (pain, fever, blisters, redness, …)
4. **Combined result:** Photo overrides symptoms if they conflict
5. Show feedback + optional shop product suggestions
6. Award Elaycoins (`nachsorge_check` +50, series bonuses)
7. If rot → prompt “Studio kontaktieren” → Chat tab

### Production plan

| Phase | Behavior |
|-------|----------|
| **A** | Photo stored on VPS/MongoDB; **rule-based** ampel (no external AI) |
| **B** | Optional AI photo analysis after legal consent + feature flag |

**APIs (planned):**

```
POST /api/v1/nachsorge/check
GET  /api/v1/nachsorge?case_id=:id
```

Until live, show prototype-equivalent UI with “coming soon” or call backend team for timeline.

---

## 11. Verlauf (session history)

Per-case timeline, newest session first.

Each session row:
- Date, session number
- `verblassung_prozent` (removal %)
- Progress photo (if studio uploaded)
- Pain score (customer-visible subset)

```
GET /api/v1/sessions?case_id=:id&page=1&limit=20
```

Customers have **read-only** access. Laser settings and payment details may be hidden — confirm fields in Swagger for `role: customer`.

---

## 12. Shop (ElayShop)

Prototype: product grid, product detail modal, cart, 3-step checkout (address → payment → confirm), order history.

**Backend:** Studio-side shop admin exists. **Customer order APIs are not fully documented for mobile yet.**

UI should match prototype; wire to APIs when backend confirms:
- Product catalog (studio-scoped or platform catalog)
- Cart / checkout
- Order history

---

## 13. Studios (discover)

Search by Ort / PLZ / studio name. Map is placeholder in prototype.

```
GET /api/v1/studios/public
```

In prototype, tapping a studio can start a new case at that studio. **Studio switching for existing customers** requires admin approval (M3+ — not built).

---

## 14. Profile

| Section | Behavior | API |
|---------|----------|-----|
| Avatar + name | Display | `GET /auth/me` |
| Edit profile | vorname, nachname, telefon, address | ⚠️ customer PATCH TBD |
| Mein Studio | Current studio name, registered since | From `auth/me` + studio embed |
| Studio wechseln | Multi-step + signature → admin queue | M3+ |
| Daten export | DSG export download | M3+ |
| Logout | Clear tokens | `POST /auth/logout` |

---

## 15. PMU case (7-step wizard — prototype parity)

Home has two CTAs: **Neuer Tattoo-Case** and **Neuer PMU-Case**. Same APIs; set `type: "pmu"`.

Prototype / production steps:

| Step | Code | Fields |
|------|------|--------|
| 1 | PMU_01 | `tc_title`, `pmu_type`, `pmu_side?`, `pmu_age_range`, `pmu_technique`, `pigment_type?`, `stitch_depth` |
| 2 | PMU_02 | `previously_lasered`, `lasered_notes?` |
| 3 | PMU_03 | `colors[]`, `color_density`, `color_saturation`, `has_shading`, `has_linework` |
| 4 | PMU_04 | `life_smoker`, `life_alcohol`, `life_activity`, `life_hydration`, `life_aftercare_commitment` |
| 5 | PMU_05 | `paradox_darkening_acknowledged` + session/price estimate (`GET …/pricing` or create response) |
| 6 | PMU_06 | Intake photos — same file API as TC_06 (`photo_intake_main`, `photo_intake_detail`, `photo_marker`) |
| — | — | After save: anamnese → Merkblatt → signature on case detail (same as tattoo) |

```
POST /api/v1/cases
{ "type": "pmu", "tc_title": "Augenbrauen links", "pmu_type": "eyebrows", ... }
```

Then same medical close-out as tattoo: anamnese → Merkblatt → signature → booking.

PMU enums match the prototype exactly (e.g. `pmu_age_range: "<1"|"1-3"|…`, colors as `Schwarz`/`Braun`/…).

---

## 16. Medical flow — prototype parity (Phases A–E)

End-to-end map of what the **customer app** must implement vs what **studio** does. Binding reference: customer prototype + studio klaerung UI.

```
Customer App                              Studio Dashboard (web)
─────────────                             ─────────────────────
TC_07 answers + live preview ampel   →    Case shows medical_flag_level
PUT anamnesis (answers immutable)    →    Orange/rot flags appear
TC_08 Merkblatt + TC_09 signature    →    Case leaves draft → pending
Book treatment + PS_01               →    Appointment + lockouts update
                                     →    Klaerung (offen → in_klaerung → geklaert)
                                     →    Freigabe Stufe 2 if required
                                     →    Effective ampel updates on lists/CRM
```

### Customer must implement (ready APIs)

| Phase | Prototype behavior | Mobile APIs |
|-------|--------------------|-------------|
| **A** | Live ampel + hints while answering; red/orange **do not** stop completion | `POST …/anamnesis/preview`, `PUT …/anamnesis` |
| **B** | Merkblatt scroll + canvas signature; finalize case | `GET …/merkblatt`, `POST …/signature` |
| **C** | Ampel on Home / case cards | Use `medical_flag_level` on case list/detail |
| **D** | PS_01 before treatment calendar: UV, meds, KO re-ask, wiederholungen, optional KO sig | `GET/POST …/booking-precheck`, `booking_precheck` on appointments |
| **E** | — | **Studio only** (`PATCH …/klaerung`, `PATCH …/studio-freigabe`). Mobile only **displays** effective ampel after klaerung |

### Exact prototype rules (do not “improve”)

1. **Finish with red:** Customer can complete anamnesis and sign even if ampel is `rot`. Copy: studio will contact; booking re-asks KO points.
2. **Klärung ≠ edit answers:** Studio never changes “Diabetes Typ 1” text; they set klaerung status. Mobile never offers “edit medical answers after sign” without product decision.
3. **Freigabe ≠ klaerung:** Stufe-2 freigabe is a separate studio gate for certain red triggers.
4. **Beratung vs Behandlung:** Beratung skips PS_01; Behandlung requires it.
5. **Signature path:** Always `POST …/signature`, not status PATCH to `active`.

### Gaps vs prototype (honest)

| Prototype UI | Production status |
|--------------|-------------------|
| Studio live Chat tab | Placeholder / stub — not ready for mobile |
| Intake photo upload | ✅ `POST /files/staging`, link on `POST /cases`, `GET /files/:id/content` |
| Merkblatt PDF generation | Optional client `merkblatt_pdf`; server PDF gen not required |
| Kurzfristig CHF 50 fee copy | Coins malus on backend; CHF fee messaging product-side |
| Elaya FAB AI | `POST /chat` planned |
| Nachsorge AI | Planned (rule-based Phase A) |

---

## 17. API reference — ready vs planned

### Ready for mobile integration ✅

| Method | Path | Use in app |
|--------|------|------------|
| `GET` | `/health` | Connectivity check |
| `GET` | `/studios/public` | Registration studio picker |
| `POST` | `/auth/register/customer` | Signup |
| `POST` | `/auth/login` | Login |
| `POST` | `/auth/refresh` | Token refresh |
| `POST` | `/auth/logout` | Logout |
| `GET` | `/auth/me` | Profile bootstrap |
| `POST` | `/auth/forgot-password` | Forgot password |
| `POST` | `/auth/reset-password` | Reset password |
| `GET` | `/cases` | Home case list (+ `medical_flag_level`) |
| `POST` | `/cases` | Start new case |
| `GET` | `/cases/:id` | Case detail |
| `PATCH` | `/cases/:id` | Update intake fields (not signature) |
| `GET` | `/cases/:id/availability` | Booking calendar + lockouts |
| `GET` | `/cases/:id/pricing` | KI result screen |
| `GET` | `/cases/:id/anamnesis` | Load anamnese |
| `POST` | `/cases/:id/anamnesis/preview` | Live ampel while answering |
| `PUT` | `/cases/:id/anamnesis` | Save anamnese |
| `GET` | `/cases/:id/merkblatt` | TC_08 leaflet |
| `POST` | `/cases/:id/signature` | TC_09 sign + finalize draft |
| `GET` | `/cases/:id/signature/image` | Reload stored signature image |
| `GET` | `/cases/:id/booking-precheck` | PS_01 form schema |
| `POST` | `/cases/:id/booking-precheck/preview` | Validate PS_01 before calendar |
| `POST` | `/appointments` | Book (+ `booking_precheck` if treatment) |
| `GET` | `/appointments` | List appointments |
| `PATCH` | `/appointments/:id` | Reschedule / cancel |
| `GET` | `/sessions` | Verlauf |
| `GET` | `/elaycoins/me` | Elaycoins widget |
| `GET` | `/config/public` | Group booking limits, coin display rules |
| `POST` | `/files/staging` | Upload intake photo (returns file ID) |
| `GET` | `/files/:id/content` | Display private photo (Bearer) |
| `DELETE` | `/files/:id` | Remove unlinked staging photo |

### Studio-only file routes (optional for mobile)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/files/cases/:caseId/intake` | Upload directly to existing case |
| `POST` | `/files/sessions/:sessionId/progress` | Session progress photo |

### Studio-only (do not call from customer app)

| Method | Path | Purpose |
|--------|------|---------|
| `PATCH` | `/cases/:id/anamnesis/klaerung` | Flag review without changing answers |
| `PATCH` | `/cases/:id/studio-freigabe` | Stufe-2 freigabe |

### Planned — coordinate with backend ⏳

| Method | Path | Use in app |
|--------|------|------------|
| `POST` | `/chat` | Elaya AI assistant (FAB) |
| `POST` | `/nachsorge/check` | Aftercare photo + symptoms |
| `GET` | `/nachsorge` | Nachsorge history |
| `PATCH` | `/customers/me` | Profile edit |
| Shop endpoints | TBD | ElayShop checkout |

### Case fields — aligned with prototype (Jul 2026)

All intake fields from steps TC_01–TC_06 (and PMU_01–PMU_06) plus signature metadata are on **`POST/PATCH /cases`** / signature endpoint. Photo fields store **file asset IDs** from `/files/staging`, not public URLs. Full field list: [`docs/CUSTOMER-CASE-INTAKE-SPEC.md`](./docs/CUSTOMER-CASE-INTAKE-SPEC.md) (if present in your docs tree).

**PMU (`type: "pmu"`):** full 7-step intake on backend + studio web; same case APIs as tattoo with PMU-specific fields (`pmu_type`, `pmu_age_range`, `colors`, `paradox_darkening_acknowledged`, …).

**Still optional / not built yet:**
- Server-side Merkblatt **PDF generation** (`merkblatt_pdf` optional)
- Zone-level lockout nuance in mobile calendar (backend lockouts are case-level)
- Nachsorge check endpoint + session progress photo flow in mobile UI

---

## 18. Suggested integration order

1. **Auth** — register (studio picker), login, me, forgot/reset  
2. **Home** — cases list with ampel, availability badges, appointments  
3. **Case wizard TC_01–06 + photos + pricing** — staging upload → PATCH intake → pricing screen  
4. **PMU wizard PMU_01–06** — same APIs with `type: "pmu"`  
5. **Medical A–B** — preview ampel → PUT anamnesis → Merkblatt → signature  
6. **Booking + PS_01** — booking-precheck → availability → POST appointments  
7. **Verlauf + Elaycoins** — sessions list, coin widget  
8. **Elaya FAB** — when `POST /chat` is live  
9. **Nachsorge** — when `/nachsorge/check` endpoint is live  
9. **Shop, Chat, Studio switch** — later milestones  

---

## Appendix A — Pagination

All list endpoints support:

```
?page=1&limit=20
```

Response shape:

```json
{
  "success": true,
  "data": {
    "cases": [],
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

---

## Appendix B — Test credentials

Ask backend team for staging URL and seed accounts. Local seed often uses:

- Studio code: `INKFREE`
- Swagger: `{BASE_URL}/api/v1/docs`

**Do not run `npm run seed:demo` on production VPS.**

---

## Appendix C — Related documents

| Document | Location |
|----------|----------|
| **Case intake — all fields** | [`CUSTOMER-CASE-INTAKE-SPEC.md`](./CUSTOMER-CASE-INTAKE-SPEC.md) |
| Full API README | `backend/README.md` |
| Business rules handoff | `DEVELOPER-HANDOFF-EN.md` |
| Interactive prototype | `inkderm-prototype/public/customer/index.html` |
| Studio medical UI | Studio Case Detail — Klaerung + Freigabe panels |

---

*Questions: contact the Elaya backend team. For Swagger details and env-specific base URLs, see `backend/README.md`.*

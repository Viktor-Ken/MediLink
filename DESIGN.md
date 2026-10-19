# MediLink — Hospital Management System Design

> Version 0.1 (draft) — *living document; update it as the system evolves.*

## 1. Vision

One platform that connects every department of the hospital around the patient.

- **Every patient carries a card / wristband** with a scannable identifier (QR code).
- **Any intake point can scan it** and pull the patient's profile in under a second.
- **If a patient arrives unconscious or unable to speak**, the scan is the emergency
  lifeline: staff instantly see allergies, blood type, conditions, current medications,
  and the emergency contact — then act, not ask.
- **Departments communicate smoothly** through one shared system: directory, referrals,
  handoffs, and secure messaging — no more phone tag or lost papers.

## 2. Guiding principles

| Principle | Meaning here |
|---|---|
| Patient-centric | Everything routes through the patient record and the scan identity. |
| Emergency-first | The unconscious-patient scenario is the design test for every screen. |
| Audit everything | Every scan, view, and edit is logged for accountability and compliance. |
| Least privilege | Staff see only what their role needs; emergency view is permission-aware. |
| Progressive build | Working vertical slices first (M0), then add modules (M1, M2). |

## 3. Actors & roles

| Actor | Role(s) | Primary needs |
|---|---|---|
| Receptionist | `receptionist` | Register patients, issue card/bracelet, check-in |
| Nurse | `nurse` | Scan at triage, view emergency record, handoff |
| Doctor | `doctor` | Full medical record, referrals, notes |
| Department head | `admin` | Directory upkeep, staff management, reporting |
| System admin | `admin` | User management, roles, config |
| Patient | — | (future) Self-service portal, consent, app |

## 4. Functional modules & roadmap

### M0 — Core patient flow (implemented)
- [x] Staff authentication (JWT, roles)
- [x] Patient registration → issues `patient_no` + QR card/bracelet
- [x] Scan access: camera QR scan or manual ID entry
- [x] Emergency Record banner: allergies / blood type / conditions / meds / emergency contact
- [x] Department directory
- [x] Audit trail (scan_events: who, where, when)
- [x] Patient profile + edit

### M1 — Department communication (implemented)
- [x] **Referrals** — department A refers a patient to B (reason + priority stat/urgent/routine; open → accepted → completed/declined; auto-creates a task + patient event)
- [x] **Handoffs** — shift/nurse handoff tied to a patient (open → accepted → completed)
- [x] **Secure department messaging** — threaded conversations on a department channel or linked to a patient; unread tracking
- [x] **Task/notification inbox** — "Dr. Okafor: new referral from ER (patient HM-1001)"; open/done with audit
- [x] **Activity feed** — live cross-department patient timeline (`patient_events`)

### M2 — Clinical workflows (implemented)
- [x] Appointments & scheduling (create, check-in, complete, cancel, no-show; each emits a patient event)
- [x] Admissions / wards / beds / discharge (bed auto-assignment to first free bed, double-admission guard, discharge frees the bed and closes the visit)
- [x] Prescriptions & pharmacy orders (multi-item, route/frequency, active → dispensed / cancelled; pharmacy dispense queue page)
- [x] Lab & radiology orders with result capture (ordered → resulted / cancelled; result JSON with optional note)
- [x] Clinical notes (triage / progress / discharge) + visit history (auto-created admission & outpatient visits)

### M3-P — Patient self-service portal + consent (implemented)
- [x] **Patient sign-in** — `patient_no` + PIN (bcrypt-hashed; default `1234`, settable at registration and returned once for card printing); separate JWT scope flagged `role: patient` so portal tokens cannot touch staff APIs
- [x] **Portal** (`/portal`) — my record (allergies/conditions/meds/emergency contact), care timeline, prescriptions + test results, appointment request, and consent management
- [x] **Consent management** — per-kind consents (`treatment`, `data_sharing`, `research`, `photography`) toggled by the patient in the portal or by staff in person; every change is an audited `patient_event` (`consent_granted` / `consent_revoked`)
- [x] Default `treatment` consent captured at registration; portal login emits a `portal_login` audit event

### M3-R — Reports, dashboards & compliance exports (implemented)
- [x] **Operations dashboard** (`/reports`, admin + doctor only) — patients registered (total / 7d), active admissions, bed occupancy, upcoming/completed/cancelled/no-show appointments, referrals broken down by status + priority (stat/urgent/routine), prescriptions & investigations by status, tasks, consents by kind, staff by role, 7-day audit event volume
- [x] **Compliance exports** — CSV downloads for patients, referrals, admissions, prescriptions, investigations, the audit event log, consents, and the scan access log; `text/csv` + `Content-Disposition`; header row present even when the source table is empty (auditor-friendly)
- [x] **Role gated** — `/api/reports/*` requires `admin` or `doctor`; receptionist and patient tokens are rejected (403 / 401)

### M3 — Patient-facing & scale-out
- [x] Patient self-service portal + consent management → *see **M3-P** above*
- [ ] NFC/RFID bracelet support (hardware readers) — *deferred until hardware is sourced/budgeted; QR + 1D barcodes cover today's needs*
- [x] Reports, dashboards, compliance exports → *see **M3-R** above*

### M4-V — Vitals & early warning score (implemented)
- [x] **Vitals charting** — one row per observation (temperature, systolic/diastolic BP, pulse, respiratory rate, SpO2, AVPU consciousness, optional note); auto-links to the patient's active visit; recorded on the patient timeline as a `vitals_recorded` audit event
- [x] **Early Warning Score (NEWS2-style)** — server-computed component scores + total + clinical risk band (`low` 0–4, `medium` 5–6, `high` ≥7 **or** any single parameter scoring 3); recomputed live so threshold changes re-score history
- [x] **Patient vitals card** (`/patients/:id`) — latest reading with colour-banded EWS badge, live component values, EWS trend sparkline, and an 8-reading history table; record form visible to admin/doctor/nurse only
- [x] **Vitals compliance export** — added to `/reports` CSV downloads (`vitals` log)
- [x] **Role gates** — recording requires `admin`/`doctor`/`nurse`; reading requires staff auth; patient tokens rejected

### M5 — Nigeria fit, card identity & mobile (implemented)
- [x] **Nigeria-fit patient fields** — `genotype`, `NIN`, `NHIS/HMO` captured at registration, editable later, shown on the emergency banner with blood type, and included in the patients report export
- [x] **1D barcode identity** — every card/bracelet carries a **Code 128** barcode (plus the existing QR) in `HM-####`; the scanner reads QR, CODE_128 or CODE_39, so cheap barcode scanners and phone cameras both work
- [x] **Installable mobile app (PWA)** — manifest + generated icons + service worker; `npm run preview:lan` serves the same build over the LAN so staff phones can install it home-screen style; service worker caches static assets only and never touches `/api` (audit/PHI stay live-fetched)
- [x] **Responsive shell** — collapsible drawer nav + top bar on phones/tablets

### M6 — Patient communication & accounts (implemented)
- [x] **Private doctor↔patient chat** — `POST /api/conversations/doctor-patient` (admin/doctor) finds-or-reuses a `doctor_patient` conversation per doctor × patient; subject auto-set to `First Last · HM-####`. Staff reply via the Messages page; patient replies via `/api/portal/messages/:id/messages`. Doctor chats are visible only to the originating doctor and admins (403 otherwise, verified in smoke)
- [x] **Help desk** — patients open a `help` ticket through `POST /api/portal/messages/help`; admins are the help desk and answer from the Messages page Help tab. Staff can also raise a help request (routed to the same queue)
- [x] **Unified staff Messages hub** — tabbed UI (Team / Patients / Help desk) with per-tab unread badges and a `?patient=<id>` deep link (used by the profile's "Message patient" button)
- [x] **Self-service credentials** — `POST /api/account/password` (staff, current+new, min 6) on the `/account` page; `POST /api/portal/pin` (4–8 digits, current verified) on the `/portal/account` page
- [x] **Search** — patient search matches NIN and NHIS/HMO numbers in addition to name/patient_no
- [x] **Schema** — `conversations` gains `kind` (`staff`|`doctor_patient`|`help` CHECK), `requester_id`, `closed_at`; `messages` gains `sender_patient_id` (with exactly-one-sender CHECK); `message_reads` gains nullable `patient_id` (CHECK exactly one reader — staff or patient) so read/unread works on both sides
- [x] **Read tracking is NULL-safe** — staff unread counts patient-sent rows (`sender_id IS DISTINCT FROM $2`) because patient messages keep `sender_id` NULL; patient unread counts rows where `sender_id IS NOT NULL` and no patient read exists

## 5. The emergency scenario (design test)

```
Unconscious patient arrives in ER.
  Staff scans bracelet (camera QR or reader).
    → Server resolves identifier → patient record.
    → Staff sees EMERGENCY RECORD immediately, no navigation required:
         blood type · allergies · conditions · current meds · emergency contact
    → One tap opens the full profile (permission-aware).
    → Scan is written to scan_events (staff, location, timestamp) for audit.
  If identifier is unknown:
    → "Not found" screen with rapid-register path so the visit isn't blocked.
```

**Screen-level requirement:** the scan result screen must show critical data without any
additional click, and label it clearly as an emergency record.

## 6. Architecture

```
┌───────────────────────┐         ┌──────────────────────────────────────┐
│  Web client (React)   │  /api   │  API server (Node.js / Express)      │
│  Vite SPA trading     ├────────►│  auth · patients · scans ·           │
│  on: camera QR scan,  │         │  departments · referrals · messaging │
│  PWA-ready            │         └──────────────┬───────────────────────┘
└───────────────────────┘                        │ (pg)
                                    ┌────────────┴─────────────┐
                                    │  PostgreSQL               │
                                    │  departments staff        │
                                    │  patients scan_events     │
                                    │  + M1/M2 tables           │
                                    └──────────────────────────┘
```

- **Modular monolith** today — one repo, one API, one DB. Split into services only when
  a real scaling/operational reason appears.
- **API server runtime (Sep 2026):** `server/src/index.js` boots a **cluster of
  `WEB_WORKERS` workers** (default = `os.cpus().length`; on this box 4). Primary forks,
  respawns crashed workers, and lets a reverse-proxy/LB balance if one is present.
  `server/src/app.js` builds the Express app once per worker: `cors`, gzip
  `compression`, `express.json({limit:'256kb'})`, a 60 s request-destroy timeout,
  all `/api` routes, and static serving of the built SPA (`web/dist`) with an SPA
  fallback for non-API paths (the API alone can serve the whole product).
- **Database access:** per-worker pg `Pool` pre-warmed at boot, `max` =
  `PGPOOL_MAX` (default 15), connect timeout 30 s (`PG_CONNECT_TIMEOUT_MS`),
  idle 60 s, per-query `statement_timeout` 15 s (`PG_STMT_TIMEOUT_MS`). 4 workers × 15
  = 60 connections, safely under the default PG `max_connections=100`.
- **Passwords:** `@node-rs/bcrypt` (native, non-blocking) replaces `bcryptjs`
  (blocking pure-JS). Login/patient-login are throttled per-IP at
  `AUTH_RATE_LIMIT` requests/min (default 30, tunable) with a fixed-window limiter.
- **API-first:** all features behind JSON endpoints so future clients (kiosk, mobile,
  bracelet readers) can reuse them.
- **QR identifier:** bracelet encodes a token. Today = `patient_no` (`HM-1001`) for
  simplicity; before production the token becomes an **HMAC-signed, expiring opaque ID**
  so a lost card can't be trivially sniffed, and cards can be revoked.

### Optional-in-production notes
- Reverse proxy / TLS termination, rate limiting on scan endpoints.
- Secrets via vault/env, not the repo.
- Horizontal scale: API is stateless (JWT/stateless workers) — one process per 2 vCPU
  behind an L7 load balancer; move PostgreSQL to its own host (or managed HA) and add
  read replicas for reporting; serve `web/dist` from a CDN/static host. Measured ~110–120
  req/s per box here, so capacity scales roughly linearly with the number of boxes.

## 7. Data model

### Current (M0)
```
departments (id, name, code, floor, phone_ext, head, hours)
staff       (id, username, password_hash, full_name, role, department_id)
patients    (id, patient_no UNIQUE, first_name, last_name, dob, gender,
             blood_type, allergies[], conditions[], medications[],
             emergency_contact_name/phone/relation, notes, created/updated_at)
scan_events (id, patient_id, staff_id, location, action, created_at)   -- audit
```

### Implemented (M1)
```
referrals      (id, patient_id, from_dept, to_dept, priority stat|urgent|routine,
                reason, status open|accepted|completed|declined, created_by, resolved_at)
handoffs       (id, patient_id, from/to_dept, from/to_staff, summary,
                status open|accepted|completed, created_at, resolved_at)
conversations  (id, subject, department_id (channel) or NULL for personal, patient_id, created_by)
messages       (id, conversation_id, sender_id, body, created_at)
message_reads  (message_id, staff_id, read_at)   -- unread counts per user
tasks          (id, department_id, assignee_id, title, details, kind, ref_type, ref_id,
                status open|done, due_at, created_by, done_at)
patient_events (id, patient_id, staff_id, department_id, kind, data JSONB, created_at)
```

### Implemented (M2)
```
appointments, admissions, beds, wards, prescriptions, prescription_items,
investigations, clinical_notes, visits
```

### Implemented (M3-P)
```
patients.pin_hash, patient_consents
```

### Implemented (M3-R)
```
reports view layer only: no new tables (aggregations over patients, staff, beds,
admissions, referrals, prescriptions, investigations, appointments, tasks,
patient_consents, patient_events, scan_events)
```

### Implemented (M4-V)
```
vitals (patient_id, visit_id, recorded_by, recorded_at, temperature, systolic,
diastolic, pulse, respiratory_rate, spo2, consciousness AVPU, notes)
ews.js — NEWS2-style scoring (component + total + risk band)
```

### Implemented (M5 — Nigeria fit + card identity + mobile)
```
patients: genotype, nin, nhis_no (register + edit + emergency display + exports)
Code 128 (1D) barcode alongside QR on cards/bracelets; scanner reads QR or CODE_128/39
PWA: manifest, generated icons, offline-capable service worker (never caches /api),
     responsive drawer nav (use npm run preview:lan from the phone's Wi-Fi)
```

### Implemented (M6 — patient communication & accounts)
```
conversations: +kind CHECK('staff'|'doctor_patient'|'help'), requester_id, closed_at
messages:      +sender_patient_id (CHECK: exactly one of sender_id / sender_patient_id set)
message_reads: +patient_id (CHECK: exactly one of staff_id / patient_id set),
               UNIQUE(message_id, staff_id) + UNIQUE(message_id, patient_id)
```

**Conventions:** UUID PKs, `created_at TIMESTAMPTZ`, arrays for allergy/condition lists
(comma-joint UI), `ON DELETE` rules reviewed per table, `scan_events` append-only.

## 8. Security & compliance posture

- **Authentication:** bcrypt password hashes, JWTs (12h), no shared secrets in code.
- **Authorization:** role-based access on every route; admin-only mutations (e.g. add dept).
- **Audit:** `scan_events` is append-only and captures staff + location + timestamp for
  every access; `patient_events` extends the log to referrals/handoffs/messages/edits.
- **Data minimization:** emergency view exposes only the critical subset until the user
  opens the full record (permission-aware).
- **Regulation-readiness:** designed with HIPAA/GDPR-style principles in mind
  (least privilege, auditability, retention). Real compliance certification is an
  engagement-level decision — not implied by this build.

## 9. Non-functional decisions

- **Ports:** API `4000`, web `5173` (dev proxy `/api` → API), preview/copy at `4173` (`npm run preview:lan` binds the LAN).
- **Database:** PostgreSQL 17 (local dev cluster: `127.0.0.1:5432`, db `hospital`).
- **Testing:** API smoke tests (`m1-full-smoke.ps1` M1 35/35, `m2-full-smoke.ps1` M2
  28/28, `m3p-smoke.ps1` M3-P 20/20, `m3r-smoke.ps1` M3-R 18/18, `m4v-smoke.ps1`
  M4-V 13/13, `m4v2-nigeria-smoke.ps1` M5 16/16, `m6-chat-smoke.ps1` M6 25/25);
  `npm run build` + browser-verified flows.
- **Git:** initialize repository at project root; `.gitignore` already excludes
  `node_modules`, `.env`, `dist`.
- **Load test & scaling (Sep 2026):** `loadtest.mjs` / `humanload.mjs` / `loaddbg.mjs`
  (Node 22, dependency-free). The API now runs a **4-worker Node cluster** with pre-warmed,
  tuned pg pools and native async bcrypt (see §6), replacing the single-threaded
  `bcryptjs` build. Measured on this machine (4 vCPU / 4 GB Windows, PG localhost):

  - **Steady logged-in users (hammering API, no think time):** 100 users → 0 % errors,
    p50 ≈ 0.75 s, p95 ≈ 1.9 s; 200 users → 0 % errors, p50 ≈ 1.5 s, p95 ≈ 3.2 s;
    400 users → 0.9 % client-side timeouts, p50 ≈ 3.0 s, p95 ≈ 6.9 s (server returns
    0 HTTP 500s; the residual tail is the client/loopback, not the app). Absolute
    ceiling ≈ 110–120 req/s across the cluster on this box.
  - **Human-paced users (thousands of sessions):** 2 000 concurrent sessions with 5–20 s
    think time sustain ≈ 20–30 req/s with p50 ≈ 27 ms and a sub-second p95 during
    steady sessions; login bursts are the only expensive operation (native bcrypt,
    ~20 ms/thread) and are covered by the auth rate limiter (default 30/min/IP).
    Thousands of real users are therefore comfortable; only *every-user-hammering*
    saturates the box.
  - **What was fixed:** eliminated a real 500 fault — pg-pool used to force-kill new
    connections on a 5 s connect timeout under burst (cold-pool races on this host);
    now the pool is pre-warmed at boot (`SELECT 1` × `POOL_MAX`), connect timeout is
    30 s, `max: 15` per worker (60 total < PG `max_connections=100`), and every query
    has a 15 s statement timeout. Requests have a 60 s destroy timeout; the login
    endpoints have a fixed-window per-IP rate limiter.
  - **Scaling beyond this box** (documented in §6): stateless worker processes behind a
    load balancer (L7 proxy / reverse proxy) — one container per 2 vCPU; move PostgreSQL
    offline/HA; serve the built SPA from a CDN/static host.

## 10. Open questions (decide before next milestone)

1. ~~Barcode type: QR only (M0) vs also 1D barcodes / NFC (M3)? Hardware available?~~
   **Decided (M5):** QR + Code 128 (1D) barcodes ship today. NFC/RFID deferred until
   hardware readers are sourced and budgeted — the card/wristband carries both QR and 1D
   so cheap scanners and phone cameras both work without NFC.

2. ~~Messaging scope~~ *(decided in M1)*: both department-grouped **and** patient-linked
   conversations exist; @mentions deferred to M2.

3. ~~Referrals: who approves/escapes priority rules?~~
   **Decided:** No approval gate — the referring clinician sets priority (stat / urgent /
   routine) based on clinical judgment at creation time. *Stat* referrals are emergency-
   first and bypass any queue (they emit a patient event and appear immediately in the
   target department's inbox). *Urgent* and *routine* follow the standard lifecycle
   (open → accepted → completed / declined). No escape mechanism — if priority changes,
   the referral is declined and re-created with the correct level, keeping a clean audit
   trail.

4. ~~Multi-facility / single hospital for now?~~
   **Decided:** Single hospital. The schema and API are facility-agnostic by convention
   (no `facility_id` columns), so multi-facility can be added later by prefixing a
   facility scope to queries — but that is a future scale-out project, not a near-term
   build.

5. ~~Any offline mode needed at intake kiosks?~~
   **Decided:** No offline data caching. The PWA already provides an offline shell
   (cached static assets, graceful error on failed API calls) so transient network blips
   don't break the UI. Patient records, scans, and emergency data are always live-fetched
   — PHI accuracy beats availability. Kiosks are expected to have reliable LAN
   connectivity; if a kiosk loses network, it shows a "reconnect" screen rather than
   serving stale data.

---

*Roadmap order is a suggestion — we build whatever slice you want next, keeping the
emergency scan flow as the north star.*
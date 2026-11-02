# MediLink — Hospital Management System

One platform that connects every department of the hospital around the patient.
Patients carry a scannable QR card/bracelet; any intake point scans it and pulls the
emergency record in under a second. Departments coordinate through referrals, handoffs,
and secure messaging.

## Stack

- **Web client** — React 18 (Vite), React Router, `html5-qrcode` camera scanning, `qrcode` for card printing
- **API** — Node.js 22 / Express (ESM), JWT auth, bcrypt
- **Database** — PostgreSQL 17

## Features

**M0 — Core patient flow**
- Staff authentication with roles (admin / doctor / nurse / receptionist)
- Patient registration → auto `HM-####` number + QR **and Code 128 barcode** card/bracelet
- Scan access: camera scan of QR, CODE_128 or CODE_39, or manual ID entry
- Emergency record banner (allergies, blood type, genotype, conditions, meds, contact)
- Department directory, patient profile + edit, scan audit trail

**M1 — Department communication**
- Referrals with priority (stat / urgent / routine) and open → accepted → completed/declined lifecycle
- Patient handoffs between shifts/departments
- Secure threaded messaging — department channels or patient-linked conversations, unread tracking
- Task/notification inbox (auto-created from referrals etc.)
- Cross-department patient activity timeline

**M2 — Clinical workflows**
- Appointments & scheduling (create / check-in / complete / cancel / no-show)
- Wards & beds bed-board with live occupancy; admissions with auto bed assignment, double-admission guard, discharge
- Prescriptions (multi-item, dose/frequency/route) with pharmacy dispense queue
- Lab & radiology orders with result capture
- Clinical notes (triage / progress / discharge) and visit history

**M3-P — Patient self-service portal & consent**
- Patient sign-in at `/portal` with patient number + PIN (shared on registration)
- View your record, care timeline, prescriptions & test results
- Request appointments; grant/withdraw consents (treatment / data sharing / research / photography)
- Staff can record consents in person; all consent changes are audited on the patient timeline

**M3-R — Reports & compliance**
- Operations dashboard at `/reports` (admin / doctor) — occupancy, referrals, meds & tests, consents, staff
- One-click CSV exports for audits: patients, referrals, admissions, prescriptions, investigations, event log, consents, scan access log, vitals

**M4-V — Vitals & early warning**
- Chart temperature, BP, pulse, respiratory rate, SpO2 and consciousness per observation on the patient profile
- Automatic NEWS2-style early warning score with risk band and trend sparkline; audit event on every reading
- Vitals log included in the compliance CSV exports

**M5 — Nigeria fit & mobile**
- Nigeria-specific patient fields: genotype, NIN, NHIS/HMO number (shown on the emergency banner, editable, exported)
- Installable mobile app (PWA): home-screen install on phones/tablets, responsive drawer nav, offline shell
- `npm run preview:lan` serves the built app over the local network for phone installs

**M6 — Patient communication & accounts**
- **Private doctor↔patient chat**: any doctor/admin can start a secure thread with a patient from the Messages page or directly from a patient's profile; the patient answers in their portal
- **Help desk**: patients can raise support requests from the portal (`/portal/messages`); admins resolve them in the Messages page
- **Messages hub rework**: the staff Messages page is now tabbed (Team / Patients / Help desk) with unread badges and `?patient=<id>` deep links
- **Self-service security**: staff can change their own password (`/account`); patients can change their portal PIN (`/portal/account`)
- Patient search now matches NIN and NHIS/HMO numbers as well as names/IDs

**Optional AI assistant** — set `OPENAI_API_KEY` in `server/.env` to enable a floating chat
widget on every staff page and, separately, on the patient portal (`/portal`). The two are
scoped independently: the staff assistant helps with workflows and interpreting app data; the
patient one only helps navigate the portal, is never given real record data, and always
redirects clinical or urgent questions to the patient's care team or emergency services. See
`server/.env.example` for the full set of `CHAT_*` / `PORTAL_CHAT_*` options.

See `DESIGN.md` for the full design, data model, and roadmap (M0→M6).

## Setup

### 1. Database

Local PostgreSQL 17 instance (`hospital` database, user `postgres`, password `postgres`,
host `127.0.0.1:5432`). Adjust `server/.env` if yours differs.

```bash
cd server
npm run db:migrate     # applies schema.sql + seeds departments/staff/patients
```

### 2. API (port 4000)

```bash
cd server
npm install
npm start
```

### 3. Web client (port 5173)

```bash
cd web
npm install
npm run dev            # http://localhost:5173  (proxies /api → 127.0.0.1:4000)
```

## Demo logins

| Username    | Password      | Role        | Department |
|-------------|---------------|-------------|------------|
| admin       | admin123      | admin       | —          |
| reception   | reception     | receptionist| Registration |
| er.nurse    | er.nurse      | nurse       | ER         |
| dr.okafor   | dr.okafor     | doctor      | Inpatient  |

Patient portal (`/portal`) accounts: all seeded patients use a **portal PIN of `1234`**
(e.g. `HM-1001` / `1234`).

Tip for testing referrals: log in as `er.nurse` to send one, then as `dr.okafor` to
accept/complete it and watch the task + timeline update.

## Project layout

```
server/   API (Express) — src/routes/*, schema.sql, migrate.js, smoke tests
web/      React SPA (Vite) — src/pages/*, src/components/*
DESIGN.md Living design doc (vision, data model, roadmap, decisions)
```

## Security testing

CI runs an OWASP ZAP scan and a dependency audit on every PR to `main` (plus
a nightly active/attacking ZAP scan). See [SECURITY-TESTING.md](SECURITY-TESTING.md)
for what runs, how to triage a finding, and how to run ZAP locally.
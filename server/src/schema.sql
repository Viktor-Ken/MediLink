CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  floor TEXT,
  phone_ext TEXT,
  head TEXT,
  hours TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'optometrist', 'lab_scientist')),
  department_id UUID REFERENCES departments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_no TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  dob DATE,
  gender TEXT,
  blood_type TEXT,
  allergies TEXT[] NOT NULL DEFAULT '{}',
  conditions TEXT[] NOT NULL DEFAULT '{}',
  medications TEXT[] NOT NULL DEFAULT '{}',
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relation TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff(id),
  location TEXT,
  action TEXT NOT NULL DEFAULT 'scan',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_patients_patient_no ON patients(patient_no);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_events_created ON scan_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_patient ON scan_events(patient_id);

CREATE SEQUENCE IF NOT EXISTS patient_no_seq START 1001;

-- ============ M1: department communication ============

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  from_department_id UUID NOT NULL REFERENCES departments(id),
  to_department_id UUID NOT NULL REFERENCES departments(id),
  priority TEXT NOT NULL DEFAULT 'routine'
    CHECK (priority IN ('stat', 'urgent', 'routine')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'completed', 'declined')),
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  from_department_id UUID REFERENCES departments(id),
  to_department_id UUID REFERENCES departments(id),
  from_staff_id UUID REFERENCES staff(id),
  to_staff_id UUID REFERENCES staff(id),
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  patient_id UUID REFERENCES patients(id) ON DELETE SET NULL,
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES staff(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES staff(id),
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, staff_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES departments(id),
  assignee_id UUID REFERENCES staff(id),
  title TEXT NOT NULL,
  details TEXT,
  kind TEXT NOT NULL DEFAULT 'task',
  ref_type TEXT,
  ref_id UUID,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  due_at TIMESTAMPTZ,
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS patient_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES staff(id),
  department_id UUID REFERENCES departments(id),
  kind TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_to_dept ON referrals(to_department_id, status);
CREATE INDEX IF NOT EXISTS idx_referrals_from_dept ON referrals(from_department_id, status);
CREATE INDEX IF NOT EXISTS idx_handoffs_to_dept ON handoffs(to_department_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_dept ON tasks(department_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_patient_events_patient ON patient_events(patient_id, created_at DESC);

-- ============ M2: clinical workflows ============

CREATE TABLE IF NOT EXISTS visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id),
  visit_type TEXT NOT NULL DEFAULT 'outpatient'
    CHECK (visit_type IN ('outpatient', 'admission')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  created_by UUID REFERENCES staff(id)
);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id),
  staff_id UUID REFERENCES staff(id),
  scheduled_for TIMESTAMPTZ NOT NULL,
  duration_min INT NOT NULL DEFAULT 30,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show')),
  created_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  floor TEXT,
  department_id UUID REFERENCES departments(id)
);

CREATE TABLE IF NOT EXISTS beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ward_id UUID NOT NULL REFERENCES wards(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'maintenance')),
  UNIQUE (ward_id, label)
);

CREATE TABLE IF NOT EXISTS admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  ward_id UUID REFERENCES wards(id),
  bed_id UUID REFERENCES beds(id),
  reason TEXT,
  admitted_by UUID REFERENCES staff(id),
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  discharged_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'discharged'))
);

CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  prescribed_by UUID REFERENCES staff(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'dispensed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prescription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id UUID NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  drug_name TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,
  route TEXT NOT NULL DEFAULT 'oral',
  duration_days INT
);

CREATE TABLE IF NOT EXISTS investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id),
  kind TEXT NOT NULL CHECK (kind IN ('lab', 'radiology')),
  test_name TEXT NOT NULL,
  clinical_note TEXT,
  status TEXT NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'in_progress', 'resulted', 'cancelled')),
  result_json JSONB,
  ordered_by UUID REFERENCES staff(id),
  resulted_by UUID REFERENCES staff(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resulted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS clinical_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES visits(id),
  staff_id UUID REFERENCES staff(id),
  note_type TEXT NOT NULL DEFAULT 'progress'
    CHECK (note_type IN ('triage', 'progress', 'consult', 'discharge_summary')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_dept ON appointments(department_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_appointments_patient ON appointments(patient_id, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_beds_ward ON beds(ward_id);
CREATE INDEX IF NOT EXISTS idx_beds_status ON beds(status);
CREATE INDEX IF NOT EXISTS idx_admissions_active ON admissions(status, bed_id);
CREATE INDEX IF NOT EXISTS idx_admissions_patient ON admissions(patient_id, admitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rx_status ON prescriptions(status);
CREATE INDEX IF NOT EXISTS idx_rx_items ON prescription_items(prescription_id);
CREATE INDEX IF NOT EXISTS idx_inv_patient ON investigations(patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_status ON investigations(status, kind);
CREATE INDEX IF NOT EXISTS idx_notes_patient ON clinical_notes(patient_id, created_at DESC);

-- ============ M3-P: patient portal & consent ============

ALTER TABLE patients ADD COLUMN IF NOT EXISTS pin_hash TEXT;

CREATE TABLE IF NOT EXISTS patient_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('treatment', 'data_sharing', 'research', 'photography')),
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted', 'revoked')),
  note TEXT,
  set_by_staff UUID REFERENCES staff(id),
  set_via TEXT NOT NULL DEFAULT 'staff' CHECK (set_via IN ('staff', 'portal')),
  set_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patient_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_consents_patient ON patient_consents(patient_id, status);

-- ============ M4-V: vitals & early warning score ============

CREATE TABLE IF NOT EXISTS vitals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id UUID REFERENCES visits(id),
  recorded_by UUID REFERENCES staff(id),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  temperature NUMERIC(4,1),
  systolic NUMERIC,
  diastolic NUMERIC,
  pulse NUMERIC,
  respiratory_rate NUMERIC,
  spo2 NUMERIC,
  consciousness TEXT CHECK (consciousness IN ('alert', 'voice', 'pain', 'unresponsive')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_vitals_patient ON vitals(patient_id, recorded_at DESC);

-- ============ M4-B: Nigeria identification & barcode ============

ALTER TABLE patients ADD COLUMN IF NOT EXISTS genotype TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nin TEXT;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS nhis_no TEXT;

-- ============ M6: doctor-patient chat & help desk ============

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'staff';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS requester_id UUID REFERENCES staff(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS chk_conversations_kind;
ALTER TABLE conversations ADD CONSTRAINT chk_conversations_kind
  CHECK (kind IN ('staff', 'doctor_patient', 'help'));
CREATE INDEX IF NOT EXISTS idx_conversations_kind_patient ON conversations(kind, patient_id);
CREATE INDEX IF NOT EXISTS idx_conversations_kind_creator ON conversations(kind, created_by);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_sender;
ALTER TABLE messages ADD CONSTRAINT chk_messages_sender
  CHECK (sender_id IS NOT NULL OR sender_patient_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_sender_patient ON messages(sender_patient_id);

ALTER TABLE message_reads DROP CONSTRAINT IF EXISTS message_reads_pkey;
ALTER TABLE message_reads ADD COLUMN IF NOT EXISTS patient_id UUID REFERENCES patients(id) ON DELETE CASCADE;
ALTER TABLE message_reads ALTER COLUMN staff_id DROP NOT NULL;
ALTER TABLE message_reads DROP CONSTRAINT IF EXISTS chk_message_reads_reader;
ALTER TABLE message_reads ADD CONSTRAINT chk_message_reads_reader
  CHECK ((staff_id IS NOT NULL)::int + (patient_id IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_reads_reader
  ON message_reads(message_id, COALESCE(staff_id::text, ''), COALESCE(patient_id::text, ''));

-- ============ M7: dedicated department roles (pharmacy, optometry, medical lab) ============

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IN ('admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'optometrist', 'lab_scientist'));

ALTER TABLE departments ADD COLUMN IF NOT EXISTS description TEXT;

-- ============ M8: admin manages patients & staff ============

ALTER TABLE staff ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- ============ M9: optional single sign-on (Clerk) ============
-- Email is used to bind a verified Clerk identity to a staff record the first
-- time someone signs in. clerk_user_id then keeps that link stable.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS clerk_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS staff_clerk_user_id_key
  ON staff (clerk_user_id) WHERE clerk_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS staff_email_lower_key
  ON staff (lower(email)) WHERE email IS NOT NULL;

-- ============ M10: revoke outstanding sessions on password change ============
-- Each staff JWT carries the token_version that was current when it was
-- issued. Bumping this column (e.g. on a password change) makes every
-- previously-issued token fail verification immediately, instead of staying
-- valid for the rest of its 12h lifetime.

ALTER TABLE staff ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- ============ M11: cluster-wide login lockout ============
-- Per-account failed-login counters used to live only in each Node worker's
-- memory, so the effective guess budget scaled with worker count. A shared
-- table makes the limit the same regardless of which worker handles a given
-- request.

CREATE TABLE IF NOT EXISTS login_lockouts (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
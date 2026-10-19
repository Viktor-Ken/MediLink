import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash as hashPassword } from '@node-rs/bcrypt';
import pool from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEPARTMENTS = [
  ['Emergency Department', 'EMERG', 'Ground Floor', '101', 'Dr. Amara Okafor', '24/7',
   '24/7 triage and initial care for acute illness and injury. Stabilizes life-threatening conditions, performs emergency assessments, and routes patients to the appropriate admitting unit.'],
  ['Cardiology', 'CARD', '1st Floor', '201', 'Dr. Daniel Chen', 'Mon-Fri 08:00-18:00',
   'Diagnoses and treats conditions of the heart and blood vessels — hypertension, heart failure, arrhythmias, and coronary disease. Provides ECG, echocardiography, stress testing, and cardiac monitoring.'],
  ['Pediatrics', 'PED', '1st Floor', '202', 'Dr. Sofia Reyes', 'Mon-Sat 08:00-20:00',
   'Medical care for infants, children, and adolescents — growth and vaccination review, childhood illnesses, and developmental monitoring. Coordinates with parents and refers complex cases to specialists.'],
  ['Radiology', 'RAD', '2nd Floor', '301', 'Dr. James Whitfield', '24/7',
   'Produces and interprets diagnostic imaging — X-ray, ultrasound, CT, and MRI — to support clinical diagnosis, guide procedures, and monitor treatment response.'],
  ['Laboratory', 'LAB', '2nd Floor', '302', 'Dr. Priya Nair', 'Daily 07:00-21:00',
   'Performs routine diagnostic testing on blood, urine, and other specimens — chemistry, hematology, microbiology, and serology — delivering accurate results to guide diagnosis and treatment.'],
  ['Pharmacy', 'PHARM', 'Ground Floor', '103', 'Mr. Samuel Bello', '24/7',
   'Prepares and dispenses prescribed medications, reviews prescriptions for safety and interactions, counsels patients on dosing and use, and manages ward stock and inventory.'],
  ['Optometry', 'OPTOM', '1st Floor', '203', 'Dr. Ngozi Umeh', 'Mon-Fri 08:00-17:00',
   'Provides primary eye and vision care — comprehensive eye examinations, refraction and glasses/contact-lens prescriptions, and screening for glaucoma, diabetic retinopathy, and other eye disease, referring surgical cases to ophthalmology.'],
  ['Medical Laboratory Science', 'MLS', '2nd Floor', '303', 'Mrs. Halima Sani', 'Daily 07:00-21:00',
   'Medical laboratory scientists analyze biological specimens — hematology, clinical chemistry, microbiology, immunology, and molecular diagnostics — validate test quality, interpret results, and report findings to clinicians.'],
  ['Administration', 'ADMIN', '3rd Floor', '401', 'Mrs. Grace Adeyemi', 'Mon-Fri 09:00-17:00',
   'Manages hospital operations — registration, records, admissions, finance, HR, and facility logistics — coordinating departments so patient care runs smoothly.'],
];

const STAFF = [
  ['admin', 'admin123', 'System Administrator', 'admin', 'ADMIN'],
  ['reception', 'reception', 'Chioma Eze', 'receptionist', 'ADMIN'],
  ['er.nurse', 'er.nurse', 'Tunde Balogun', 'nurse', 'EMERG'],
  ['dr.okafor', 'dr.okafor', 'Amara Okafor', 'doctor', 'EMERG'],
  ['pharmacist', 'pharmacist', 'Samuel Bello', 'pharmacist', 'PHARM'],
  ['optometrist', 'optometrist', 'Ngozi Umeh', 'optometrist', 'OPTOM'],
  ['lab.scientist', 'lab.scientist', 'Halima Sani', 'lab_scientist', 'MLS'],
];

const PATIENTS = [
  {
    first: 'Adaeze', last: 'Obi', dob: '1988-04-12', gender: 'Female', blood_type: 'O+', genotype: 'AS',
    allergies: ['Penicillin', 'Latex'],
    conditions: ['Type 1 Diabetes Mellitus', 'Asthma'],
    medications: ['Insulin (glargine)', 'Salbutamol inhaler'],
    ecName: 'Chuka Obi', ecPhone: '+1 555-0101', ecRelation: 'Husband',
    notes: 'Carries an emergency insulin pen in an outer jacket pocket.',
  },
  {
    first: 'Kwame', last: 'Mensah', dob: '1965-09-30', gender: 'Male', blood_type: 'A-', genotype: 'AA',
    allergies: ['Sulfa drugs'],
    conditions: ['Hypertension', 'Atrial Fibrillation'],
    medications: ['Warfarin', 'Atenolol'],
    ecName: 'Ama Mensah', ecPhone: '+1 555-0102', ecRelation: 'Daughter',
    notes: 'Anticoagulated (warfarin) - elevated bleeding risk.',
  },
  {
    first: 'Lola', last: 'Fernandez', dob: '2019-01-20', gender: 'Female', blood_type: 'B+', genotype: 'AS',
    allergies: ['Peanuts (severe)'],
    conditions: [],
    medications: [],
    ecName: 'Maria Fernandez', ecPhone: '+1 555-0103', ecRelation: 'Mother',
    notes: 'Carries an EpiPen - severe anaphylaxis risk.',
  },
];

async function seedDepartments(client) {
  await client.query(
    `INSERT INTO departments (name, code, floor, phone_ext, head, hours, description)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
    [
      DEPARTMENTS.map((d) => d[0]),
      DEPARTMENTS.map((d) => d[1]),
      DEPARTMENTS.map((d) => d[2]),
      DEPARTMENTS.map((d) => d[3]),
      DEPARTMENTS.map((d) => d[4]),
      DEPARTMENTS.map((d) => d[5]),
      DEPARTMENTS.map((d) => d[6]),
    ],
  );
  const { rows } = await client.query('SELECT id, code FROM departments');
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

// Demo accounts / patients use publicly known credentials (admin/admin123,
// PIN 1234). They are seeded only outside production, or when explicitly
// requested with SEED_DEMO=1.
const DEMO = process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO === '1';

async function seedStaff(client, deptId) {
  if (!DEMO) return seedProductionAdmin(client, deptId);
  for (const [username, password, fullName, role, code] of STAFF) {
    const passwordHash = await hashPassword(password, 10);
    // DO NOTHING: re-running the migration must never reset an existing
    // account's password back to its default.
    await client.query(
      `INSERT INTO staff (username, password_hash, full_name, role, department_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      [username, passwordHash, fullName, role, deptId[code]],
    );
  }
}

let generatedAdminPassword = null;

// Production: create a single admin only if none exists. The password comes
// from SEED_ADMIN_PASSWORD, otherwise a random one is generated and printed once.
async function seedProductionAdmin(client, deptId) {
  const { rows } = await client.query(`SELECT 1 FROM staff WHERE role = 'admin' LIMIT 1`);
  if (rows[0]) return;
  const password = process.env.SEED_ADMIN_PASSWORD || randomBytes(12).toString('base64url');
  if (password.length < 8) throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters');
  if (!process.env.SEED_ADMIN_PASSWORD) generatedAdminPassword = password;
  await client.query(
    `INSERT INTO staff (username, password_hash, full_name, role, department_id)
     VALUES ('admin', $1, 'System Administrator', 'admin', $2)
     ON CONFLICT (username) DO NOTHING`,
    [await hashPassword(password, 10), deptId.ADMIN],
  );
}

const DEMO_PIN = '1234';

async function seedPatients(client) {
  if (!DEMO) return;
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM patients');
  if (Number(n) > 0) return;
  const pinHash = await hashPassword(DEMO_PIN, 10);
  for (const p of PATIENTS) {
    await client.query(
      `INSERT INTO patients
        (patient_no, first_name, last_name, dob, gender, blood_type, genotype,
         allergies, conditions, medications, pin_hash,
         emergency_contact_name, emergency_contact_phone, emergency_contact_relation, notes)
       VALUES
        ('HM-' || nextval('patient_no_seq'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        p.first, p.last, p.dob, p.gender, p.blood_type, p.genotype,
        p.allergies, p.conditions, p.medications, pinHash,
        p.ecName, p.ecPhone, p.ecRelation, p.notes,
      ],
    );
  }
}

async function seedPatientAccess(client) {
  if (!DEMO) return;
  const pinHash = await hashPassword(DEMO_PIN, 10);
  await client.query(
    `UPDATE patients SET pin_hash = $1 WHERE pin_hash IS NULL`,
    [pinHash],
  );
  await client.query(
    `INSERT INTO patient_consents (patient_id, kind, status, set_via, note)
     SELECT id, 'treatment', 'granted', 'staff', 'Implied consent captured at registration'
     FROM patients
     ON CONFLICT (patient_id, kind) DO NOTHING`,
  );
}

async function seedNigeriaProfile(client) {
  // Demo-only: would otherwise overwrite genotypes on real HM-1001..1003 records.
  if (!DEMO) return;
  await client.query(`UPDATE patients SET genotype = 'AS' WHERE patient_no = 'HM-1001' AND genotype IS NULL`);
  await client.query(`UPDATE patients SET genotype = 'AA' WHERE patient_no = 'HM-1002' AND genotype IS NULL`);
  await client.query(`UPDATE patients SET genotype = 'AS' WHERE patient_no = 'HM-1003' AND genotype IS NULL`);
}

const WARDS = [
  ['Ward A — General Medicine', '1st Floor', 'CARD'],
  ['Ward B — Pediatrics', '1st Floor', 'PED'],
];

const BEDS = {
  'Ward A — General Medicine': ['A1', 'A2', 'A3', 'A4'],
  'Ward B — Pediatrics': ['B1', 'B2', 'B3'],
};

const DEMO_PATIENT_NO = 'HM-1001';

async function seedWards(client) {
  for (const [name, floor, code] of WARDS) {
    await client.query(
      `INSERT INTO wards (name, floor, department_id)
       SELECT $1, $2, id FROM departments WHERE code = $3
       ON CONFLICT (name) DO UPDATE SET floor = EXCLUDED.floor`,
      [name, floor, code],
    );
    const ward = await client.query('SELECT id FROM wards WHERE name = $1', [name]);
    for (const label of BEDS[name]) {
      await client.query(
        `INSERT INTO beds (ward_id, label) VALUES ($1, $2)
         ON CONFLICT (ward_id, label) DO NOTHING`,
        [ward.rows[0].id, label],
      );
    }
  }
}

async function seedDemoClinical(client) {
  if (!DEMO) return;
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM prescriptions');
  if (Number(n) > 0) return;

  const { rows: patientRows } = await client.query(
    'SELECT id FROM patients WHERE patient_no = $1',
    [DEMO_PATIENT_NO],
  );
  if (!patientRows[0]) return;
  const patientId = patientRows[0].id;

  const { rows: docRows } = await client.query(
    'SELECT id FROM staff WHERE username = $1',
    ['dr.okafor'],
  );
  if (!docRows[0]) return;
  const docId = docRows[0].id;

  const { rows: deptRows } = await client.query(
    'SELECT id FROM departments WHERE code = $1',
    ['EMERG'],
  );
  const deptId = deptRows[0]?.id || null;

  const { rows: labRows } = await client.query(
    'SELECT id FROM departments WHERE code = $1',
    ['LAB'],
  );
  const labId = labRows[0]?.id || null;

  const { rows: wardRows } = await client.query(
    `SELECT w.id AS ward_id, b.id AS bed_id
     FROM wards w JOIN beds b ON b.ward_id = w.id
     WHERE w.name = $1 AND b.label = $2`,
    ['Ward A — General Medicine', 'A1'],
  );
  const bed = wardRows[0] || null;

  if (bed) {
    await client.query(
      `INSERT INTO admissions (patient_id, ward_id, bed_id, reason, admitted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [patientId, bed.ward_id, bed.bed_id, 'Seeded demo admission — cardiac observation', docId],
    );
    await client.query(`UPDATE beds SET status = 'occupied' WHERE id = $1`, [bed.bed_id]);
    await client.query(
      `INSERT INTO visits (patient_id, department_id, visit_type, reason, status, created_by)
       VALUES ($1, $2, 'admission', $3, 'active', $4)`,
      [patientId, deptId, 'Seeded demo admission', docId],
    );
  }

  const { rows: rx } = await client.query(
    `INSERT INTO prescriptions (patient_id, prescribed_by, status, notes)
     VALUES ($1, $2, 'active', $3) RETURNING id`,
    [patientId, docId, 'Seeded demo: control glucose'],
  );
  await client.query(
    `INSERT INTO prescription_items (prescription_id, drug_name, dose, frequency, route, duration_days)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [rx[0].id, 'Insulin (glargine)', '10 units', 'once daily at bedtime', 'subcutaneous', 30],
  );

  await client.query(
    `INSERT INTO investigations (patient_id, department_id, kind, test_name, clinical_note, ordered_by, status)
     VALUES ($1, $2, 'lab', 'Full Blood Count', 'Baseline on admission', $3, 'ordered')`,
    [patientId, labId, docId],
  );

  await client.query(
    `INSERT INTO clinical_notes (patient_id, staff_id, note_type, body)
     VALUES ($1, $2, 'triage', $3)`,
    [patientId, docId, 'Seeded demo: admitted for cardiac monitoring; stable on observation.'],
  );
}

const DEMO_VITALS = [
  { hrsAgo: 6, temperature: 38.7, systolic: 148, diastolic: 92, pulse: 118, respiratory_rate: 24, spo2: 92, consciousness: 'alert' },
  { hrsAgo: 5, temperature: 38.4, systolic: 138, diastolic: 86, pulse: 110, respiratory_rate: 22, spo2: 93, consciousness: 'alert' },
  { hrsAgo: 4, temperature: 38.1, systolic: 132, diastolic: 84, pulse: 104, respiratory_rate: 20, spo2: 94, consciousness: 'alert' },
  { hrsAgo: 3, temperature: 37.8, systolic: 128, diastolic: 80, pulse: 96, respiratory_rate: 18, spo2: 95, consciousness: 'alert' },
  { hrsAgo: 2, temperature: 37.4, systolic: 124, diastolic: 78, pulse: 88, respiratory_rate: 17, spo2: 96, consciousness: 'alert' },
  { hrsAgo: 1, temperature: 37.2, systolic: 120, diastolic: 76, pulse: 84, respiratory_rate: 16, spo2: 97, consciousness: 'alert' },
];

async function seedDemoVitals(client) {
  if (!DEMO) return;
  const patientId = (await client.query(
    'SELECT id FROM patients WHERE patient_no = $1',
    [DEMO_PATIENT_NO],
  )).rows[0]?.id;
  if (!patientId) return;
  const { rows: [{ n }] } = await client.query(
    'SELECT count(*)::int AS n FROM vitals WHERE patient_id = $1',
    [patientId],
  );
  if (Number(n) > 0) return;

  const { rows: docRows } = await client.query(
    'SELECT id FROM staff WHERE username = $1',
    ['dr.okafor'],
  );
  const docId = docRows[0]?.id || null;
  const visitId = (await client.query(
    `SELECT id FROM visits WHERE patient_id = $1 AND status = 'active' ORDER BY started_at DESC LIMIT 1`,
    [patientId],
  )).rows[0]?.id || null;

  for (const v of DEMO_VITALS) {
    await client.query(
      `INSERT INTO vitals (patient_id, visit_id, recorded_by, recorded_at,
                           temperature, systolic, diastolic, pulse, respiratory_rate, spo2, consciousness)
       VALUES ($1, $2, $3, now() - ($4 || ' hours')::interval, $5, $6, $7, $8, $9, $10, $11)`,
      [patientId, visitId, docId, v.hrsAgo, v.temperature, v.systolic, v.diastolic, v.pulse, v.respiratory_rate, v.spo2, v.consciousness],
    );
  }
}

async function main() {
  const schema = await readFile(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(schema);
    const deptId = await seedDepartments(client);
    await seedStaff(client, deptId);
    await seedPatients(client);
    await seedPatientAccess(client);
    await seedNigeriaProfile(client);
    await seedWards(client);
    await seedDemoClinical(client);
    await seedDemoVitals(client);
    await client.query('COMMIT');

    const { rows: deps } = await client.query('SELECT count(*)::int AS n FROM departments');
    const { rows: stf } = await client.query('SELECT count(*)::int AS n FROM staff');
    const { rows: pats } = await client.query('SELECT count(*)::int AS n FROM patients');
    const { rows: nos } = await client.query('SELECT patient_no FROM patients ORDER BY patient_no LIMIT 3');
    const { rows: wds } = await client.query('SELECT count(*)::int AS n FROM wards');
    const { rows: bds } = await client.query('SELECT count(*)::int AS n FROM beds');
    const { rows: vits } = await client.query('SELECT count(*)::int AS n FROM vitals');
    console.log('Database ready.');
    console.log(`  departments : ${deps[0].n}`);
    console.log(`  staff       : ${stf[0].n}`);
    console.log(`  patients    : ${pats[0].n} (${nos.map((r) => r.patient_no).join(', ')}${pats[0].n > 3 ? ', ...' : ''})`);
    console.log(`  wards/beds  : ${wds[0].n} wards / ${bds[0].n} beds`);
    console.log(`  vitals      : ${vits[0].n}`);
    if (DEMO) {
      console.log('  login       : admin / admin123 (demo data — do not use in production)');
      console.log('  portal PIN  : demo patients use 1234 (demo data — do not use in production)');
    } else if (generatedAdminPassword) {
      console.log(`  admin login : admin / ${generatedAdminPassword}  (generated — shown once, change it after first sign-in)`);
    } else {
      console.log('  demo data skipped (production). Set SEED_DEMO=1 to load it.');
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.stack);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
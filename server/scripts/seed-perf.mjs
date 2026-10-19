/**
 * Seed the isolated perf DB with a realistic-scale dataset (default 10k patients
 * + child rows so /reports/status aggregations have real cost).
 * Leaves the demo `hospital` DB untouched.
 *
 *   PGDATABASE=hospital_perf node scripts/seed-perf.mjs [count]
 */
import { hash as hashPassword } from '@node-rs/bcrypt';
import pool from '../src/db.js';

const N = Number(process.argv[2] || 10000);
const BATCH = 1000;

const FIRST = ['Adaeze','Kwame','Lola','Chidi','Amina','Tobi','Ngozi','Emeka','Funke','Sadiq',
  'Blessing','Yusuf','Chiamaka','Ibrahim','Zainab','Oluwaseun','Hauwa','Kelechi','Fatima','Damilola',
  'Grace','Musa','Ifeoma','Abdul','Nneka','Segun','Aisha','Tunde','Uche','Halima'];
const LAST = ['Obi','Mensah','Fernandez','Balogun','Adeyemi','Nwosu','Bello','Eze','Sani','Okafor',
  'Uche','Danjuma','Okonkwo','Yusuf','Abubakar','Olawale','Mbah','Ibrahim','Ogundipe','Salami'];
const GENO = ['AA','AS','SS','AC','SC'];
const BT = ['O+','O-','A+','A-','B+','B-','AB+','AB-'];
const ALLERGY = ['Penicillin','Latex','Sulfa drugs','Peanuts','Ibuprofen','Shellfish','Dust mites'];
const CONDITION = ['Hypertension','Type 2 Diabetes','Asthma','Sickle Cell','Arthritis'];
const MED = ['Metformin','Lisinopril','Salbutamol','Amlodipine','Paracetamol'];
const REL = ['Spouse','Parent','Sibling','Child','Friend'];

const r = (arr) => arr[Math.floor(Math.random() * arr.length)];
const yr = (a, b) => `${a + Math.floor(Math.random() * (b - a))}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;
const list = (src, n) => Array.from({ length: n }, () => r(src));

async function main() {
  const client = await pool.connect();
  try {
    const { rows: [{ n: existing }] } = await client.query('SELECT count(*)::int AS n FROM patients');
    const { rows: [{ n: refN }] } = await client.query('SELECT count(*)::int AS n FROM referrals');
    if (existing >= N && refN > 0) { console.log(`Already ${existing} patients / ${refN} referrals — skipping.`); return; }

    const pinHash = await hashPassword('1234', 10);
    await client.query('BEGIN');

    let inserted = 0;
    for (let off = existing; off < N; off += BATCH) {
      const size = Math.min(BATCH, N - off);
      const fn = [], ln = [], dob = [], g = [], bt = [], gt = [], al = [], co = [], me = [], ecn = [], ecp = [], ecr = [], nt = [];
      for (let i = 0; i < size; i++) {
        const f = r(FIRST), l = r(LAST);
        fn.push(f); ln.push(l);
        dob.push(yr(1945, 2018));
        g.push(Math.random() < 0.5 ? 'Female' : 'Male');
        bt.push(r(BT)); gt.push(r(GENO));
        al.push(list(ALLERGY, 1 + Math.floor(Math.random() * 2)).join(','));
        co.push(list(CONDITION, Math.floor(Math.random() * 2)).join(','));
        me.push(list(MED, Math.floor(Math.random() * 2)).join(','));
        ecn.push(`${r(FIRST)} ${l}`); ecp.push(`+234 80${Math.floor(10000000 + Math.random() * 89999999)}`);
        ecr.push(r(REL)); nt.push('Perf-seeded patient.');
      }
      await client.query(
        `INSERT INTO patients
           (patient_no, first_name, last_name, dob, gender, blood_type, genotype,
            allergies, conditions, medications, pin_hash,
            emergency_contact_name, emergency_contact_phone, emergency_contact_relation, notes)
         SELECT 'HM-' || nextval('patient_no_seq'),
                u.fn, u.ln, u.dob, u.g, u.bt, u.gt,
                CASE WHEN u.al = '' THEN ARRAY[]::text[] ELSE STRING_TO_ARRAY(u.al, ',') END::text[],
                CASE WHEN u.co = '' THEN ARRAY[]::text[] ELSE STRING_TO_ARRAY(u.co, ',') END::text[],
                CASE WHEN u.me = '' THEN ARRAY[]::text[] ELSE STRING_TO_ARRAY(u.me, ',') END::text[],
                $14::text, u.ecn, u.ecp, u.ecr, u.nt
         FROM unnest($1::text[], $2::text[], $3::date[], $4::text[], $5::text[], $6::text[],
                     $7::text[], $8::text[], $9::text[], $10::text[], $11::text[],
                     $12::text[], $13::text[])
           AS u(fn, ln, dob, g, bt, gt, al, co, me, ecn, ecp, ecr, nt)`,
        [fn, ln, dob, g, bt, gt, al, co, me, ecn, ecp, ecr, nt, pinHash],
      );
      inserted += size;
    }

    // Child rows for report aggregation realism
    const { rows: pats } = await client.query('SELECT id FROM patients');
    const { rows: docs } = await client.query(`SELECT id FROM staff WHERE role='doctor' LIMIT 5`);
    const { rows: depts } = await client.query('SELECT id FROM departments');
    const pid = pats.map((p) => p.id);
    const docId = docs[0]?.id;
    const d0 = depts[0]?.id, d1 = depts[1]?.id || depts[0]?.id;
    const pickPid = () => pid[Math.floor(Math.random() * pid.length)];

    const fill = async (n, per, cols, sql, ctor) => {
      for (let i = 0; i < n; i += per) {
        const s = Math.min(per, n - i);
        const vals = ctor(s);
        await client.query(sql, cols.map((c) => vals[c])).catch((e) => console.error('child:', e.message));
      }
    };

    await fill(3000, 500, ['p', 'f', 't', 'pri', 'st', 'rs', 'cr'],
      `INSERT INTO referrals (patient_id, from_department_id, to_department_id, priority, status, reason, created_by)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::uuid[])`,
      (s) => ({
        p: Array.from({ length: s }, pickPid),
        f: Array(s).fill(d0), t: Array(s).fill(d1),
        pri: Array.from({ length: s }, () => r(['stat', 'urgent', 'routine'])),
        st: Array.from({ length: s }, () => r(['open', 'accepted', 'completed', 'declined'])),
        rs: Array.from({ length: s }, () => r(['Chest pain', 'Review results', 'Follow-up', 'Imaging', 'Worsening symptoms'])),
        cr: Array(s).fill(docId),
      }));

    await fill(3000, 500, ['p', 'b', 'st'],
      `INSERT INTO prescriptions (patient_id, prescribed_by, status)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[])`,
      (s) => ({
        p: Array.from({ length: s }, pickPid),
        b: Array(s).fill(docId),
        st: Array.from({ length: s }, () => r(['active', 'dispensed', 'cancelled'])),
      }));

    await fill(5000, 1000, ['p', 's', 'l', 'ac'],
      `INSERT INTO scan_events (patient_id, staff_id, location, action)
       SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::text[])`,
      (s) => ({
        p: Array.from({ length: s }, pickPid),
        s: Array(s).fill(docId),
        l: Array.from({ length: s }, () => r(['ER', 'Registration', 'Ward A', 'Lab'])),
        ac: Array.from({ length: s }, () => r(['view', 'emergency_view', 'scan'])),
      }));

    await client.query('COMMIT');
    const { rows: c } = await client.query(`SELECT
      (SELECT count(*) FROM patients) p,
      (SELECT count(*) FROM referrals) rf,
      (SELECT count(*) FROM prescriptions) rx,
      (SELECT count(*) FROM scan_events) sc`);
    console.log(`Seeded: ${c[0].p} patients, ${c[0].rf} referrals, ${c[0].rx} prescriptions, ${c[0].sc} scan_events (inserted ${inserted} patients)`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('seed failed:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}
main();

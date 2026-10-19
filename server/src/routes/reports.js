import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'doctor'));

function toCsv(rows, headers) {
  if (!rows.length) {
    return headers ? `${headers.join(',')}\n` : 'no data\n';
  }
  const keys = headers || Object.keys(rows[0]);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize CSV formula injection
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.map(esc).join(',')];
  for (const r of rows) lines.push(keys.map((k) => esc(r[k])).join(','));
  return lines.join('\n') + '\n';
}

async function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(toCsv(rows, COLS[filename]));
}

router.get('/stats', async (req, res, next) => {
  try {
    const [
      { rows: patients },
      { rows: staff },
      { rows: admissions },
      { rows: beds },
      { rows: referrals },
      { rows: rx },
      { rows: inv },
      { rows: appts },
      { rows: events7 },
      { rows: consents },
      { rows: tasks },
    ] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS registered_7d
         FROM patients`,
      ),
      pool.query(
        `SELECT role, count(*)::int AS n FROM staff GROUP BY role ORDER BY role`,
      ),
      pool.query(
        `SELECT status, count(*)::int AS n FROM admissions GROUP BY status`,
      ),
      pool.query(
        `SELECT status, count(*)::int AS n FROM beds GROUP BY status`,
      ),
      pool.query(
        `SELECT status, count(*)::int AS n, count(*) FILTER (WHERE priority = 'stat')::int AS stat,
                count(*) FILTER (WHERE priority = 'urgent')::int AS urgent,
                count(*) FILTER (WHERE priority = 'routine')::int AS routine
         FROM referrals GROUP BY status`,
      ),
      pool.query(
        `SELECT status, count(*)::int AS n FROM prescriptions GROUP BY status`,
      ),
      pool.query(
        `SELECT status, count(*)::int AS n FROM investigations GROUP BY status
         UNION ALL
         SELECT 'total_' || kind, count(*)::int FROM investigations GROUP BY kind`,
      ),
      pool.query(
        `SELECT
           count(*) FILTER (WHERE status = 'scheduled')::int AS upcoming,
           count(*) FILTER (WHERE status = 'completed' AND scheduled_for >= now() - interval '7 days')::int AS completed_7d,
           count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
           count(*) FILTER (WHERE status = 'no_show')::int AS no_show
         FROM appointments`,
      ),
      pool.query(
        `SELECT count(*)::int AS total FROM patient_events WHERE created_at >= now() - interval '7 days'`,
      ),
      pool.query(
        `SELECT kind, status, count(*)::int AS n FROM patient_consents GROUP BY kind, status ORDER BY kind`,
      ),
      pool.query(
        `SELECT status, count(*)::int AS n FROM tasks GROUP BY status`,
      ),
    ]);

    res.json({
      patients: patients[0],
      staff,
      admissions,
      beds,
      referrals,
      prescriptions: rx,
      investigations: inv,
      appointments: appts[0],
      events_7d: events7[0].total,
      consents,
      tasks,
    });
  } catch (err) {
    next(err);
  }
});

const COLS = {
  patients: ['patient_no', 'first_name', 'last_name', 'dob', 'gender', 'blood_type', 'genotype', 'nin', 'nhis_no', 'allergies', 'conditions', 'medications', 'emergency_contact_name', 'emergency_contact_phone', 'created_at'],
  referrals: ['created_at', 'patient_no', 'from_department', 'to_department', 'priority', 'status', 'reason', 'resolved_at'],
  admissions: ['admitted_at', 'patient_no', 'ward', 'bed', 'reason', 'status', 'discharged_at', 'admitted_by'],
  prescriptions: ['created_at', 'patient_no', 'status', 'notes', 'drugs', 'prescribed_by'],
  investigations: ['ordered_at', 'patient_no', 'kind', 'test_name', 'status', 'result', 'department', 'ordered_by', 'resulted_at'],
  events: ['created_at', 'patient_no', 'kind', 'data', 'staff', 'department'],
  consents: ['set_at', 'patient_no', 'kind', 'status', 'set_via', 'set_by', 'note'],
  scans: ['created_at', 'patient_no', 'action', 'location', 'staff'],
  vitals: ['recorded_at', 'patient_no', 'temperature', 'systolic', 'diastolic', 'pulse', 'respiratory_rate', 'spo2', 'consciousness', 'notes', 'recorded_by'],
};

const EXPORTS = {
  patients: `SELECT patient_no, first_name, last_name, dob::text AS dob, gender, blood_type,
                    genotype, nin, nhis_no,
                    array_to_string(allergies, ', ') AS allergies,
                    array_to_string(conditions, ', ') AS conditions,
                    array_to_string(medications, ', ') AS medications,
                    emergency_contact_name, emergency_contact_phone, created_at
             FROM patients ORDER BY patient_no`,
  referrals: `SELECT r.created_at, p.patient_no,
                     df.name AS from_department, dt.name AS to_department,
                     r.priority, r.status, r.reason, r.resolved_at
              FROM referrals r
              JOIN patients p ON p.id = r.patient_id
              LEFT JOIN departments df ON df.id = r.from_department_id
              LEFT JOIN departments dt ON dt.id = r.to_department_id
              ORDER BY r.created_at`,
  admissions: `SELECT a.admitted_at, p.patient_no, w.name AS ward, b.label AS bed,
                      a.reason, a.status, a.discharged_at,
                      s.full_name AS admitted_by
               FROM admissions a
               JOIN patients p ON p.id = a.patient_id
               LEFT JOIN wards w ON w.id = a.ward_id
               LEFT JOIN beds b ON b.id = a.bed_id
               LEFT JOIN staff s ON s.id = a.admitted_by
               ORDER BY a.admitted_at`,
  prescriptions: `SELECT pr.created_at, p.patient_no,
                         pr.status, pr.notes,
                         string_agg(pi.drug_name || COALESCE(' ' || pi.dose, ''), '; ') AS drugs,
                         s.full_name AS prescribed_by
                  FROM prescriptions pr
                  JOIN patients p ON p.id = pr.patient_id
                  LEFT JOIN prescription_items pi ON pi.prescription_id = pr.id
                  LEFT JOIN staff s ON s.id = pr.prescribed_by
                  GROUP BY pr.id, p.patient_no, s.full_name
                  ORDER BY pr.created_at`,
  investigations: `SELECT i.created_at AS ordered_at, p.patient_no, i.kind, i.test_name,
                          i.status, i.result_json->>'text' AS result,
                          d.name AS department,
                          s.full_name AS ordered_by, i.resulted_at
                   FROM investigations i
                   JOIN patients p ON p.id = i.patient_id
                   LEFT JOIN departments d ON d.id = i.department_id
                   LEFT JOIN staff s ON s.id = i.ordered_by
                   ORDER BY i.created_at`,
  events: `SELECT e.created_at, p.patient_no, e.kind, e.data::text AS data,
                  s.full_name AS staff, d.name AS department
           FROM patient_events e
           JOIN patients p ON p.id = e.patient_id
           LEFT JOIN staff s ON s.id = e.staff_id
           LEFT JOIN departments d ON d.id = e.department_id
           ORDER BY e.created_at`,
  consents: `SELECT c.set_at, p.patient_no, c.kind, c.status, c.set_via,
                    s.full_name AS set_by, c.note
             FROM patient_consents c
             JOIN patients p ON p.id = c.patient_id
             LEFT JOIN staff s ON s.id = c.set_by_staff
             ORDER BY c.patient_id, c.kind`,
  scans: `SELECT e.created_at, p.patient_no, e.action, e.location,
                 s.full_name AS staff
          FROM scan_events e
          JOIN patients p ON p.id = e.patient_id
          LEFT JOIN staff s ON s.id = e.staff_id
          ORDER BY e.created_at`,
  vitals: `SELECT v.recorded_at, p.patient_no, v.temperature, v.systolic, v.diastolic,
                 v.pulse, v.respiratory_rate, v.spo2, v.consciousness, v.notes,
                 s.full_name AS recorded_by
          FROM vitals v
          JOIN patients p ON p.id = v.patient_id
          LEFT JOIN staff s ON s.id = v.recorded_by
          ORDER BY v.recorded_at`,
};

router.get('/export/:type', async (req, res, next) => {
  try {
    const sql = EXPORTS[req.params.type];
    if (!sql) return res.status(404).json({ error: 'Unknown export type' });
    const { rows } = await pool.query(sql);
    await sendCsv(res, req.params.type, rows);
  } catch (err) {
    next(err);
  }
});

export default router;
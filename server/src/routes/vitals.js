import { Router } from 'express';
import pool from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitEvent } from '../events.js';
import { ewsScore } from '../ews.js';
import { cleanText } from '../util.js';

const router = Router();
router.use(requireAuth);

const NUM_FIELDS = ['temperature', 'systolic', 'diastolic', 'pulse', 'respiratory_rate', 'spo2'];

// Physiologically plausible bounds; anything outside is almost certainly a
// typing slip and would otherwise skew the early-warning score.
const RANGES = {
  temperature: [25, 45],
  systolic: [30, 300],
  diastolic: [10, 200],
  pulse: [10, 300],
  respiratory_rate: [2, 80],
  spo2: [30, 100],
};

async function findPatient(patientId) {
  const { rows } = await pool.query(
    'SELECT id, patient_no, first_name, last_name FROM patients WHERE id::text = $1 OR patient_no = $1',
    [patientId],
  );
  return rows[0] || null;
}

async function latestVisitId(patientId) {
  const { rows } = await pool.query(
    `SELECT id FROM visits WHERE patient_id = $1 AND status = 'active'
     ORDER BY started_at DESC LIMIT 1`,
    [patientId],
  );
  return rows[0]?.id || null;
}

router.post('/', requireRole('nurse', 'doctor'), async (req, res, next) => {
  try {
    const { patientId, consciousness, notes } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });

    const patient = await findPatient(patientId);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const vital = {};
    let hasValue = false;
    for (const f of NUM_FIELDS) {
      if (req.body[f] !== undefined && req.body[f] !== null && req.body[f] !== '') {
        const n = Number(req.body[f]);
        if (!Number.isFinite(n)) return res.status(400).json({ error: `${f} must be a number` });
        const [lo, hi] = RANGES[f];
        if (n < lo || n > hi) {
          return res.status(400).json({ error: `${f} must be between ${lo} and ${hi}` });
        }
        vital[f] = n;
        hasValue = true;
      }
    }
    if (consciousness) {
      const c = String(consciousness).toLowerCase();
      if (!['alert', 'voice', 'pain', 'unresponsive'].includes(c)) {
        return res.status(400).json({ error: 'consciousness must be alert/voice/pain/unresponsive' });
      }
      vital.consciousness = c;
      hasValue = true;
    }
    if (!hasValue) {
      return res.status(400).json({ error: 'At least one vital sign is required' });
    }

    const visitId = await latestVisitId(patient.id);
    const { rows } = await pool.query(
      `INSERT INTO vitals (patient_id, visit_id, recorded_by, temperature, systolic, diastolic,
                           pulse, respiratory_rate, spo2, consciousness, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, recorded_at`,
      [
        patient.id,
        visitId,
        req.staff.id,
        vital.temperature ?? null,
        vital.systolic ?? null,
        vital.diastolic ?? null,
        vital.pulse ?? null,
        vital.respiratory_rate ?? null,
        vital.spo2 ?? null,
        vital.consciousness ?? null,
        cleanText(notes, 1000) || null,
      ],
    );

    const ews = ewsScore(vital);
    const data = {
      ews: ews.total,
      risk: ews.risk,
      temperature: vital.temperature,
      systolic: vital.systolic,
      diastolic: vital.diastolic,
      pulse: vital.pulse,
      respiratoryRate: vital.respiratory_rate,
      spo2: vital.spo2,
      consciousness: vital.consciousness,
    };
    await emitEvent({
      patientId: patient.id,
      staffId: req.staff.id,
      departmentId: req.staff.department_id,
      kind: 'vitals_recorded',
      data,
    });

    res.status(201).json({ vital: rows[0], ews });
  } catch (err) {
    next(err);
  }
});

router.get('/patient/:id', requireRole('admin', 'doctor', 'nurse'), async (req, res, next) => {
  try {
    const patient = await findPatient(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const { rows } = await pool.query(
      `SELECT v.*, s.full_name AS recorded_by_name
       FROM vitals v
       LEFT JOIN staff s ON s.id = v.recorded_by
       WHERE v.patient_id = $1
       ORDER BY v.recorded_at DESC
       LIMIT 24`,
      [patient.id],
    );

    const withEws = rows.map((r) => ({ ...r, ews: ewsScore(r) }));
    res.json({
      patient,
      latest: withEws[0] || null,
      readings: withEws,
      series: [...withEws].reverse(),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
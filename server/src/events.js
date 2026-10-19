import pool from './db.js';

export async function emitEvent({ patientId, staffId = null, departmentId = null, kind, data = {} }) {
  if (!patientId) return;
  await pool.query(
    `INSERT INTO patient_events (patient_id, staff_id, department_id, kind, data)
     VALUES ($1, $2, $3, $4, $5)`,
    [patientId, staffId, departmentId, kind, JSON.stringify(data)],
  );
}
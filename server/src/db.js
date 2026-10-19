import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const POOL_MAX = Number(process.env.PGPOOL_MAX ?? 25);

const pool = new Pool({
  host:                  process.env.PGHOST     || '127.0.0.1',
  port:                  Number(process.env.PGPORT || 5432),
  user:                  process.env.PGUSER     || 'postgres',
  password:              process.env.PGPASSWORD || 'postgres',
  database:              process.env.PGDATABASE || 'hospital',
  max:                   POOL_MAX,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 30_000),
  idleTimeoutMillis:     60_000,
  statement_timeout:     Number(process.env.PG_STMT_TIMEOUT_MS ?? 15_000),
});

async function warm() {
  for (let i = 0; i < POOL_MAX; i++) {
    try {
      await pool.query('SELECT 1');
    } catch { /* pool tolerates a missed probe */ }
  }
}
warm();

export const PATIENT_COLUMNS = `
  id, patient_no, first_name, last_name, dob::text AS dob, gender, blood_type,
  genotype, nin, nhis_no,
  allergies, conditions, medications, emergency_contact_name, emergency_contact_phone,
  emergency_contact_relation, notes, created_at, updated_at
`;

export default pool;
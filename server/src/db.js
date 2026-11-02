import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';

dotenv.config();

const { Pool } = pg;

const POOL_MAX = Number(process.env.PGPOOL_MAX ?? 25);

// Managed Postgres providers (Supabase, RDS, etc.) require TLS and present a
// cert that isn't always in Node's trust store, so a plain `ssl: true` fails
// with SELF_SIGNED_CERT_IN_CHAIN. PGSSLMODE opts in without affecting a local,
// SSL-less Postgres install (the default):
//   PGSSLMODE=require      -> encrypt, don't verify the server cert (Supabase's
//                              own quick-start recommendation for node-postgres)
//   PGSSLMODE=verify-full  -> encrypt and verify (supply PGSSLROOTCERT with the
//                              provider's CA certificate, e.g. Supabase's prod-ca-2021.crt)
const sslMode = process.env.PGSSLMODE;
const ssl =
  sslMode === 'verify-full'
    ? { rejectUnauthorized: true, ca: readFileSync(process.env.PGSSLROOTCERT, 'utf8') }
    : sslMode === 'require'
      ? { rejectUnauthorized: false }
      : undefined;

// A single connection string (e.g. Supabase's "Connection string" field, or
// its pooler URI on port 6543) takes priority over the discrete PG* vars when
// set, since that's how most managed providers hand out credentials.
const connectionString = process.env.DATABASE_URL || undefined;

const pool = new Pool({
  ...(connectionString
    ? { connectionString }
    : {
        host:     process.env.PGHOST     || '127.0.0.1',
        port:     Number(process.env.PGPORT || 5432),
        user:     process.env.PGUSER     || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'hospital',
      }),
  ssl,
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
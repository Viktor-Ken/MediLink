/**
 * Create (or recreate) the isolated perf database. Leaves `hospital` untouched.
 *   node scripts/perf-create-db.mjs
 * Connects to the default DB and (re)creates `hospital_perf`.
 */
import pool from '../src/db.js';

const PERF_DB = process.env.PERF_DB || 'hospital_perf';

async function main() {
  const admin = await pool.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${PERF_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${PERF_DB}`);
    console.log(`Created database ${PERF_DB}`);
  } finally {
    admin.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

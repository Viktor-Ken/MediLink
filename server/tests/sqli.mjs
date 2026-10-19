/**
 * MediLink SQL-injection test suite.
 * Verifies that user-controlled input (path params, query strings, JSON keys
 * and values, login fields) cannot alter SQL semantics, that dynamic column
 * lists stay whitelisted, and that no SQL error text is leaked.
 *
 * Run: node tests/sqli.mjs   (server must be up, DB seeded)
 */
const BASE = 'http://127.0.0.1:4000/api';

const PAYLOADS = [
  "' OR '1'='1",
  "'; DROP TABLE patients;--",
  "' OR 1=1--",
  "admin'--",
  '" OR ""="',
  "' UNION SELECT NULL--",
  "'); DROP TABLE staff;--",
  "\\'; DROP TABLE patients;--",
];

const SQL_ERROR_RE = /(syntax error|pg_|postgresql|unterminated|relation "|column "|invalid input syntax|SELECT .* FROM)/i;

/* ── helpers ─────────────────────────────────────────────── */

async function login(username, password) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (r.status !== 200) return null;
  return (await r.json()).token;
}

const H = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

async function call(method, path, token, body = null) {
  const opts = { method, headers: token ? H(token) : { 'Content-Type': 'application/json' } };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, data, text };
}

/* ── runner ──────────────────────────────────────────────── */

let passed = 0, failed = 0;
const failures = [];
function check(label, ok, detail = '') {
  if (ok) passed++;
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ''}`); }
  return ok;
}

async function run() {
  console.log('Logging in…');
  const admin = await login('admin', 'admin123');
  const doctor = await login('dr.okafor', 'dr.okafor');
  check('admin login works', Boolean(admin));
  check('doctor login works', Boolean(doctor));
  if (!admin || !doctor) { console.error('Cannot continue without logins'); process.exit(1); }

  /* 1. Login field injection cannot bypass auth */
  for (const p of PAYLOADS) {
    const u = await call('POST', '/auth/login', null, { username: p, password: p });
    check(`login injection username ${JSON.stringify(p)} → 401`, u.status === 401, `got ${u.status}`);
    const pw = await call('POST', '/auth/login', null, { username: 'admin', password: p });
    check(`login injection password ${JSON.stringify(p)} → 401`, pw.status === 401, `got ${pw.status}`);
  }
  const classic = await call('POST', '/auth/login', null, { username: "admin' OR '1'='1' --", password: 'x' });
  check("classic auth bypass 'admin' OR '1'='1' -- → 401", classic.status === 401, `got ${classic.status}`);

  /* 2. Patient portal injection cannot bypass */
  for (const p of PAYLOADS.slice(0, 4)) {
    const r = await call('POST', '/auth/patient-login', null, { patientNo: p, pin: '1234' });
    check(`portal login injection ${JSON.stringify(p)} → 401`, r.status === 401, `got ${r.status}`);
  }

  /* 3. Baseline: list + one real patient */
  const list0 = await call('GET', '/patients', doctor);
  check('GET /patients → 200', list0.status === 200);
  const baselineCount = list0.data?.patients?.length ?? 0;
  const victim = list0.data?.patients?.[0];
  check('found a patient to exercise', Boolean(victim));
  if (!victim) { console.error('No patients available'); process.exit(1); }
  const originalFirst = victim.first_name;

  /* 4. Query-string injection in search: never 500, never leaks SQL */
  for (const p of PAYLOADS) {
    const r = await call('GET', `/patients?q=${encodeURIComponent(p)}`, doctor);
    check(`search q=${JSON.stringify(p)} → 200 & no SQL error`, r.status === 200 && !SQL_ERROR_RE.test(r.text), `status ${r.status}`);
  }

  /* 5. Path-param injection on read: 404, not 500 */
  for (const p of PAYLOADS) {
    const r = await call('GET', `/patients/${encodeURIComponent(p)}`, doctor);
    check(`GET /patients/${JSON.stringify(p)} → 404`, r.status === 404, `got ${r.status}`);
  }

  /* 6. DELETE with injected id must not delete anything */
  for (const p of PAYLOADS.slice(0, 4)) {
    const r = await call('DELETE', `/patients/${encodeURIComponent(p)}`, admin);
    check(`DELETE injected id ${JSON.stringify(p)} → 404`, r.status === 404, `got ${r.status}`);
  }

  /* 7. PUT: injected *field names* must be ignored (column whitelist) */
  const injectedKeys = {
    "first_name = 'x', role = 'admin'": 'x',
    '"first_name"; DROP TABLE patients;--': 'x',
    'first_name=now(), notes': 'x',
  };
  const putKeys = await call('PUT', `/patients/${victim.id}`, admin, injectedKeys);
  check('PUT with injected keys → 200 (ignored)', putKeys.status === 200, `got ${putKeys.status}`);
  const afterKeys = await call('GET', `/patients/${victim.id}`, admin);
  check('injected keys did not change first_name', afterKeys.data?.patient?.first_name === originalFirst,
    `got ${afterKeys.data?.patient?.first_name}`);

  /* 8. PUT: injected *value* is stored literally, not executed */
  const literal = "Robert'); DROP TABLE patients;--";
  const putVal = await call('PUT', `/patients/${victim.id}`, admin, { first_name: literal });
  check('PUT with injected value → 200', putVal.status === 200, `got ${putVal.status}`);
  check('injected value stored literally (no execution)', putVal.data?.patient?.first_name === literal,
    `got ${JSON.stringify(putVal.data?.patient?.first_name)}`);

  /* 9. POST: injected keys ignored, values stored literally */
  const postInject = await call('POST', '/patients', admin, {
    first_name: "Test'); DROP TABLE staff;--",
    last_name: 'Injection',
    "'role'": 'admin',
  });
  check('POST with injected key/value → 201', postInject.status === 201, `got ${postInject.status}`);
  const createdId = postInject.data?.patient?.id;

  /* 10. Export path-param injection: 404, never runs SQL */
  for (const p of PAYLOADS) {
    const r = await call('GET', `/reports/export/${encodeURIComponent(p)}`, doctor);
    check(`export type ${JSON.stringify(p)} → 404`, r.status === 404, `got ${r.status}`);
  }

  /* 11. Assorted read endpoints with injected query params: never 500 */
  const endpoints = ['/tasks', '/appointments', '/referrals', '/conversations', '/inbox/summary', '/departments'];
  for (const ep of endpoints) {
    const r = await call('GET', `${ep}?status=${encodeURIComponent("' OR 1=1--")}`, doctor);
    check(`${ep} with injected param → not 5xx`, r.status < 500, `got ${r.status}`);
  }

  /* 12. Integrity: tables still exist and row counts are sane */
  const list1 = await call('GET', '/patients', doctor);
  check('patients table still readable → 200', list1.status === 200);
  check('patient list not dropped/emptied', (list1.data?.patients?.length ?? 0) >= baselineCount,
    `${list1.data?.patients?.length} < ${baselineCount}`);
  const staffList = await call('GET', '/staff', admin);
  check('staff table still readable → 200', staffList.status === 200);

  /* 13. No response anywhere leaked SQL error text */
  const leakCheck = await call('GET', "/patients?q='", doctor);
  check('no SQL error text leaked in 200 response', !SQL_ERROR_RE.test(leakCheck.text));
  const leak500 = await call('GET', `/patients/${encodeURIComponent("'")}`, doctor);
  check('error path returns generic message', !SQL_ERROR_RE.test(leak500.text), leak500.text.slice(0, 120));

  /* 14. Cleanup: restore victim, remove created test patient */
  await call('PUT', `/patients/${victim.id}`, admin, { first_name: originalFirst });
  const restored = await call('GET', `/patients/${victim.id}`, admin);
  check('victim restored to original name', restored.data?.patient?.first_name === originalFirst);
  if (createdId) {
    const del = await call('DELETE', `/patients/${createdId}`, admin);
    check('cleanup: created test patient deleted', del.status === 200, `got ${del.status}`);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(`SQL injection results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }
  console.log('═══════════════════════════════════════════\n');
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1); });

/**
 * Whole-project smoke: exercises every module (M0-M6) against the running API.
 * Run: node whole-smoke.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:4000';
let pass = 0, fail = 0;
const results = [];

async function login(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, token: j.token };
}

async function get(path, token) {
  const r = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let body = null;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('application/json')) body = await r.json().catch(() => null);
  else body = await r.text().catch(() => '');
  return { status: r.status, body, ct };
}

function check(label, ok, detail) {
  if (ok) { pass++; results.push(`PASS  ${label}`); }
  else { fail++; results.push(`FAIL  ${label}  ${detail || ''}`); }
}

// ── Staff logins ────────────────────────────────────────────────
const admin = await login('/api/auth/login', { username: 'admin', password: 'admin123' });
check('login admin', admin.status === 200 && !!admin.token, `status=${admin.status}`);
const A = admin.token;

const doctor = await login('/api/auth/login', { username: 'dr.okafor', password: 'dr.okafor' });
check('login doctor', doctor.status === 200 && !!doctor.token, `status=${doctor.status}`);

const nurse = await login('/api/auth/login', { username: 'er.nurse', password: 'er.nurse' });
check('login nurse', nurse.status === 200 && !!nurse.token, `status=${nurse.status}`);

const reception = await login('/api/auth/login', { username: 'reception', password: 'reception' });
check('login reception', reception.status === 200 && !!reception.token, `status=${reception.status}`);

// ── M0: core patient flow ──────────────────────────────────────
check('M0 /auth/me', (await get('/api/auth/me', A)).status === 200);
const pat = await get('/api/patients', A);
check('M0 /patients', pat.status === 200);
const patList = Array.isArray(pat.body) ? pat.body : (pat.body?.patients || []);
const firstId = patList[0]?.id;
check('M0 patients have data', patList.length > 0, `count=${patList.length}`);
check('M0 /departments', (await get('/api/departments', A)).status === 200);
check('M0 /staff', (await get('/api/staff', A)).status === 200);
check('M0 /scans (list)', (await get('/api/scans', A)).status === 200);
if (firstId) {
  const p1 = await get(`/api/patients/${firstId}`, A);
  check('M0 /patients/:id', p1.status === 200);
  check('M0 patient events', (await get(`/api/patients/${firstId}/events`, A)).status === 200);
  check('M0 patient scans', (await get(`/api/patients/${firstId}/scans`, A)).status === 200);
}
// M5 Nigeria fields present on a patient
const sample = patList[0] || {};
const hasNg = ('genotype' in sample) || ('nin' in sample) || ('nhis_no' in sample);
check('M5 Nigeria fields (genotype/NIN/NHIS)', hasNg, `keys=${Object.keys(sample).slice(0,8)}`);

// ── M1: department communication ───────────────────────────────
check('M1 /referrals', (await get('/api/referrals', A)).status === 200);
check('M1 /handoffs', (await get('/api/handoffs', A)).status === 200);
check('M1 /conversations', (await get('/api/conversations', A)).status === 200);
check('M1 /tasks', (await get('/api/tasks', A)).status === 200);
check('M1 /inbox/summary', (await get('/api/inbox/summary', A)).status === 200);

// ── M2: clinical workflows ─────────────────────────────────────
check('M2 /appointments', (await get('/api/appointments', A)).status === 200);
check('M2 /wards', (await get('/api/wards', A)).status === 200);
check('M2 /admissions', (await get('/api/admissions', A)).status === 200);
check('M2 /prescriptions', (await get('/api/prescriptions', A)).status === 200);
check('M2 /investigations', (await get('/api/investigations', A)).status === 200);
check('M2 /notes', (await get('/api/notes', A)).status === 200);
check('M2 /visits', (await get('/api/visits', A)).status === 200);

// ── M3-R: reports & compliance ─────────────────────────────────
const stats = await get('/api/reports/stats', A);
check('M3-R /reports/stats', stats.status === 200);
const csv = await get('/api/reports/export/patients', A);
check('M3-R /reports/export/patients (CSV)', csv.status === 200 && (csv.ct.includes('csv') || String(csv.body).includes('patient')), `ct=${csv.ct}`);

// ── M4-V: vitals & early warning ───────────────────────────────
if (firstId) check('M4-V /vitals/patient/:id', (await get(`/api/vitals/patient/${firstId}`, A)).status === 200);

// ── RBAC: reception + patient tokens must NOT reach reports ────
check('RBAC reports rejects reception (403/401)', [401, 403].includes((await get('/api/reports/stats', reception.token)).status));

// ── M3-P: patient portal ───────────────────────────────────────
const portal = await login('/api/auth/patient-login', { patientNo: 'HM-1001', pin: '1234' });
check('M3-P portal login (HM-1001/1234)', portal.status === 200 && !!portal.token, `status=${portal.status}`);
const P = portal.token;
if (P) {
  check('M3-P /portal/me', (await get('/api/portal/me', P)).status === 200);
  check('M3-P /portal/timeline', (await get('/api/portal/timeline', P)).status === 200);
  check('M3-P /portal/prescriptions', (await get('/api/portal/prescriptions', P)).status === 200);
  check('M3-P /portal/appointments', (await get('/api/portal/appointments', P)).status === 200);
  check('M3-P /portal/consents', (await get('/api/portal/consents', P)).status === 200);
  check('M3-P /portal/investigations', (await get('/api/portal/investigations', P)).status === 200);
  check('M3-P /portal/messages', (await get('/api/portal/messages', P)).status === 200);
  // patient token must NOT reach staff APIs
  check('RBAC portal token rejected from /api/patients', [401, 403].includes((await get('/api/patients', P)).status));
}

console.log(results.join('\n'));
console.log(`\n===== WHOLE-PROJECT SMOKE: ${pass} passed, ${fail} failed, ${pass + fail} total =====`);
process.exit(fail ? 1 : 0);
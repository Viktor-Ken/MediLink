/**
 * MediLink regression test suite — RBAC + critical workflows
 * Run: node tests/regression.mjs
 */
const BASE = 'http://127.0.0.1:4000/api';

const ACCOUNTS = {
  admin:       ['admin',     'admin123'],
  doctor:      ['dr.okafor', 'dr.okafor'],
  nurse:       ['er.nurse',  'er.nurse'],
  reception:   ['reception', 'reception'],
  pharmacist:  ['pharmacist','pharmacist'],
  optometrist: ['optometrist','optometrist'],
  lab:         ['lab.scientist','lab.scientist'],
};

const ROLE_NAMES = {
  admin: 'admin', doctor: 'doctor', nurse: 'nurse',
  reception: 'receptionist', pharmacist: 'pharmacist',
  optometrist: 'optometrist', lab: 'lab_scientist',
};

/* ── helpers ─────────────────────────────────────────────── */

const tokenCache = {};
async function login(role) {
  if (tokenCache[role] !== undefined) return tokenCache[role];
  const [username, password] = ACCOUNTS[role];
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (r.status !== 200) { tokenCache[role] = null; return null; }
  const d = await r.json();
  tokenCache[role] = d.token;
  return d.token;
}

async function loginAll() {
  for (const role of Object.keys(ACCOUNTS)) {
    await login(role);
  }
}

function h(role, extra = {}) {
  const t = tokenCache[role];
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

async function req(method, path, role, body = null) {
  const opts = { method, headers: h(role) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const GET  = (path, role)        => req('GET',  path, role);
const POST = (path, role, body)  => req('POST', path, role, body);
const PUT  = (path, role, body)  => req('PUT',  path, role, body);
const DEL  = (path, role)        => req('DELETE', path, role);

async function withHeader(path, role, header) {
  const res = await fetch(`${BASE}${path}`, { headers: h(role) });
  return res.headers.get(header);
}

/* ── test runner ─────────────────────────────────────────── */

let passed = 0, failed = 0;
const failures = [];

function check(label, ok, detail = '') {
  if (ok) {
    passed++;
  } else {
    failed++;
    failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

function expect(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) check(label, false, `expected ${expected}, got ${actual}`);
  else check(label, true);
  return ok;
}

/* ── tests ───────────────────────────────────────────────── */

async function run() {
  console.log('Logging in all roles…');
  await loginAll();
  const allOk = Object.values(tokenCache).every((t) => t !== null);
  check('all seven logins succeed', allOk, Object.entries(tokenCache).filter(([,v])=>!v).map(([k])=>k).join(', '));

  // ── AUTH ──────────────────────────────────────────────────
  const badLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'wrong' }),
  });
  expect('bad password → 401', badLogin.status, 401);

  const noToken = await fetch(`${BASE}/patients`);
  expect('no token → 401', noToken.status, 401);

  // ── /auth/me ──────────────────────────────────────────────
  const me = await GET('/auth/me', 'admin');
  expect('GET /auth/me → 200', me.status, 200);
  expect('me username = admin', me.data?.staff?.username, 'admin');

  // ── DEPARTMENTS ───────────────────────────────────────────
  const depts = await GET('/departments', 'doctor');
  expect('GET /departments → 200', depts.status, 200);
  expect('>= 9 departments', depts.data?.departments?.length >= 9, true);
  const deptsCache = await withHeader('/departments', 'doctor', 'x-cache');
  expect('repeat /departments read served from cache', deptsCache, 'HIT');

  // ── PATIENTS ──────────────────────────────────────────────
  const patList = await GET('/patients', 'admin');
  expect('GET /patients admin → 200', patList.status, 200);
  expect('>= 3 seeded patients', patList.data?.patients?.length >= 3, true);

  const patNoAdmin = await GET('/patients', 'pharmacist');
  expect('pharmacist CAN list patients → 200', patNoAdmin.status, 200);

  const newPat = await POST('/patients', 'admin', {
    first_name: 'TestReg', last_name: 'Regression',
    dob: '1995-06-15', gender: 'Male',
  });
  const patId = newPat.data?.patient?.id;
  expect('admin create patient → 201', newPat.status, 201);
  check('patient id returned', !!patId);

  const patView = await GET(`/patients/${patId}`, 'doctor');
  expect('doctor can view patient → 200', patView.status, 200);

  // PUT admin-only
  const putNurse = await fetch(`${BASE}/patients/${patId}`, {
    method: 'PUT', headers: h('nurse'),
    body: JSON.stringify({ first_name: 'X' }),
  });
  expect('nurse PUT patient → 403', putNurse.status, 403);

  const putAdmin = await fetch(`${BASE}/patients/${patId}`, {
    method: 'PUT', headers: h('admin'),
    body: JSON.stringify({ first_name: 'TestReg', last_name: 'Regression' }),
  });
  expect('admin PUT patient → 200', putAdmin.status, 200);

  // POST (create) admin-only
  const patCreateDoc = await POST('/patients', 'doctor', { first_name: 'X' });
  expect('doctor create patient → 403', patCreateDoc.status, 403);

  // DELETE admin-only
  const delDoc = await DEL(`/patients/${patId}`, 'doctor');
  expect('doctor DELETE patient → 403', delDoc.status, 403);
  const delAdmin = await DEL(`/patients/${patId}`, 'admin');
  expect('admin DELETE patient → 200', delAdmin.status, 200);
  const delGone = await GET(`/patients/${patId}`, 'doctor');
  expect('deleted patient gone → 404', delGone.status, 404);

  // ── STAFF MANAGEMENT ─────────────────────────────────────
  const staffDoc = await GET('/staff', 'doctor');
  expect('non-admin GET /staff → 403', staffDoc.status, 403);
  const staffAdmin = await GET('/staff', 'admin');
  expect('admin GET /staff → 200', staffAdmin.status, 200);
  check('staff has active field', staffAdmin.data?.staff?.every((s) => 'active' in s));

  const newStaff = await POST('/staff', 'admin', {
    username: 'test_regression_' + Date.now(),
    password: 'secret123456',
    full_name: 'Regression Tester',
    role: 'nurse',
  });
  expect('admin create staff → 201', newStaff.status, 201);
  const staffId = newStaff.data?.staff?.id;

  const staffCreated = await GET('/staff', 'admin');
  check('staff list invalidated on create',
    staffCreated.data?.staff?.some((s) => s.username === newStaff.data.staff.username));

  const delStaff = await DEL(`/staff/${staffId}`, 'admin');
  expect('admin deactivate staff → 200', delStaff.status, 200);

  const staffDeleted = await GET('/staff', 'admin');
  expect('staff list invalidated on delete',
    staffDeleted.data?.staff?.find((s) => s.id === staffId)?.active, false);

  const loginDeact = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: newStaff.data.staff.username, password: 'secret123456' }),
  });
  expect('deactivated staff login → 401', loginDeact.status, 401);

  // ── PRESCRIPTIONS ─────────────────────────────────────────
  const rxAdmin = await POST('/prescriptions', 'admin', { patientId: 'HM-1001', items: [{ drugName: 'X' }] });
  expect('admin write prescription → 403', rxAdmin.status, 403);
  const rxDoc = await POST('/prescriptions', 'doctor', {
    patientId: 'HM-1001', items: [{ drugName: 'TestDrug', dose: '10mg', frequency: 'bd', route: 'oral', durationDays: 5 }],
    notes: 'regression test',
  });
  expect('doctor prescribe → 201', rxDoc.status, 201);
  const rxId = rxDoc.data?.prescription?.id;

  const dispAdmin = await POST(`/prescriptions/${rxId}/dispense`, 'admin');
  expect('admin dispense → 403', dispAdmin.status, 403);
  const dispPharm = await POST(`/prescriptions/${rxId}/dispense`, 'pharmacist');
  expect('pharmacist dispense → 200', dispPharm.status, 200);

  const rxNurse = await POST('/prescriptions', 'nurse', { patientId: 'HM-1001', items: [{ drugName: 'Y' }] });
  expect('nurse prescribe → 403', rxNurse.status, 403);

  // ── INVESTIGATIONS ────────────────────────────────────────
  const invAdmin = await POST('/investigations', 'admin', { patientId: 'HM-1001', kind: 'lab', testName: 'X' });
  expect('admin order investigation → 403', invAdmin.status, 403);
  const invDoc = await POST('/investigations', 'doctor', { patientId: 'HM-1001', kind: 'lab', testName: 'CBC' });
  expect('doctor order → 201', invDoc.status, 201);
  const invId = invDoc.data?.investigation?.id;

  const resAdmin = await POST(`/investigations/${invId}/result`, 'admin', { result: 'normal' });
  expect('admin result → 403', resAdmin.status, 403);
  const resLab = await POST(`/investigations/${invId}/result`, 'lab', { result: 'normal' });
  expect('lab_scientist result → 200', resLab.status, 200);

  const invRadio = await POST('/investigations', 'doctor', { patientId: 'HM-1001', kind: 'radiology', testName: 'CXR' });
  const radioId = invRadio.data?.investigation?.id;
  const labRadio = await POST(`/investigations/${radioId}/result`, 'lab', { result: 'clear' });
  expect('lab result radiology → 403', labRadio.status, 403);

  // ── NOTES ─────────────────────────────────────────────────
  const noteAdmin = await POST('/notes', 'admin', { patientId: 'HM-1001', noteType: 'progress', body: 'X' });
  expect('admin add note → 403', noteAdmin.status, 403);
  const noteNurseProg = await POST('/notes', 'nurse', { patientId: 'HM-1001', noteType: 'progress', body: 'X' });
  expect('nurse progress note → 403', noteNurseProg.status, 403);
  const noteNurseTri = await POST('/notes', 'nurse', { patientId: 'HM-1001', noteType: 'triage', body: 'ok' });
  expect('nurse triage note → 201', noteNurseTri.status, 201);
  const noteDoc = await POST('/notes', 'doctor', { patientId: 'HM-1001', noteType: 'progress', body: 'doc note' });
  expect('doctor progress note → 201', noteDoc.status, 201);

  // ── ADMISSIONS ────────────────────────────────────────────
  const admAdmin = await POST('/admissions', 'admin', { patientId: 'HM-1002' });
  expect('admin admit → 403', admAdmin.status, 403);

  // ── VITALS ────────────────────────────────────────────────
  const vitAdmin = await POST('/vitals', 'admin', { patientId: 'HM-1002', temperature: 37 });
  expect('admin record vitals → 403', vitAdmin.status, 403);
  const vitDoc = await POST('/vitals', 'doctor', { patientId: 'HM-1002', temperature: 37.5, systolic: 120, diastolic: 80, pulse: 72, respiratory_rate: 16, spo2: 98 });
  expect('doctor record vitals → 201', vitDoc.status, 201);
  check('EWS score returned', vitDoc.data?.ews?.total != null);
  check('EWS risk returned', ['low','medium','high'].includes(vitDoc.data?.ews?.risk));

  // ── CONSENTS ──────────────────────────────────────────────
  const consentAdmin = await POST('/patients/HM-1002/consents', 'admin', { kind: 'treatment', action: 'grant' });
  expect('admin toggle consent → 403', consentAdmin.status, 403);
  const consentDoc = await POST('/patients/HM-1002/consents', 'doctor', { kind: 'treatment', action: 'grant' });
  expect('doctor grant consent → 200', consentDoc.status, 200);

  // ── REFERRALS ─────────────────────────────────────────────
  const refAdmin = await POST('/referrals', 'admin', {
    patientId: 'HM-1001', toDepartmentId: null, priority: 'routine', reason: 'X',
  });
  expect('admin create referral → 403', refAdmin.status, 403);
  const deptId = (await GET('/departments', 'doctor')).data?.departments?.[1]?.id;
  const refNurse = await POST('/referrals', 'nurse', {
    patientId: 'HM-1001', toDepartmentId: deptId, priority: 'urgent', reason: 'regression',
  });
  expect('nurse create referral → 201', refNurse.status, 201);
  const refId = refNurse.data?.referral?.id;
  const refListAdmin = await GET('/referrals', 'admin');
  expect('admin can view all referrals → 200', refListAdmin.status, 200);

  // ── HANDOFFS ──────────────────────────────────────────────
  const hoAdmin = await POST('/handoffs', 'admin', { patientId: 'HM-1001', summary: 'X' });
  expect('admin create handoff → 403', hoAdmin.status, 403);
  const hoDoc = await POST('/handoffs', 'doctor', { patientId: 'HM-1001', summary: 'shift handoff' });
  expect('doctor create handoff → 201', hoDoc.status, 201);
  const hoId = hoDoc.data?.handoff?.id;
  const hoListAdmin = await GET('/handoffs', 'admin');
  expect('admin can view all handoffs → 200', hoListAdmin.status, 200);

  const hoActAdmin = await POST(`/handoffs/${hoId}/accept`, 'admin');
  expect('admin accept handoff → 403', hoActAdmin.status, 403);

  // ── TASKS ─────────────────────────────────────────────────
  const taskAdmin = await POST('/tasks', 'admin', { title: 'X' });
  expect('admin create task → 403', taskAdmin.status, 403);
  const taskListAdmin = await GET('/tasks', 'admin');
  expect('admin view all tasks → 200', taskListAdmin.status, 200);
  const taskDoneAdmin = await POST('/tasks/any/done', 'admin');
  expect('admin mark done → 403', taskDoneAdmin.status === 403 || taskDoneAdmin.status === 404, true);

  // ── PRESCRIPTION GET: all roles see correctly ─────────────
  const rxGetDoctor = await GET('/prescriptions', 'doctor');
  expect('doctor GET /prescriptions → 200', rxGetDoctor.status, 200);
  const rxGetReception = await GET('/prescriptions', 'reception');
  expect('receptionist GET /prescriptions → 403', rxGetReception.status, 403);

  // ── INVESTIGATIONS GET ────────────────────────────────────
  const invGetDoctor = await GET('/investigations', 'doctor');
  expect('doctor GET /investigations → 200', invGetDoctor.status, 200);
  const invGetPharm = await GET('/investigations', 'pharmacist');
  expect('pharmacist GET /investigations → 403', invGetPharm.status, 403);

  // ── WARDS ─────────────────────────────────────────────────
  const wardsGet = await GET('/wards', 'doctor');
  expect('doctor GET /wards → 200', wardsGet.status, 200);

  // ── SCANS ─────────────────────────────────────────────────
  const scanPost = await POST('/scans', 'doctor', { patientId: 'HM-1001' });
  expect('doctor record scan → 201', scanPost.status, 201);

  // ── PORTAL ────────────────────────────────────────────────
  const portalLogin = await fetch(`${BASE}/auth/patient-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientNo: 'HM-1001', pin: '1234' }),
  });
  expect('portal login → 200', portalLogin.status, 200);
  const portalToken = (await portalLogin.json()).token;
  const portalRecord = await fetch(`${BASE}/portal/me`, {
    headers: { Authorization: `Bearer ${portalToken}` },
  });
  expect('portal GET /me → 200', portalRecord.status, 200);

  // ── RATE LIMIT ────────────────────────────────────────────
  // Quick check: rapid bad-logins from a fresh IP should eventually 429
  // (We won't exhaust it to avoid rate-limiting our own subsequent tests)

  // ── SUMMARY ───────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }
  console.log('═══════════════════════════════════════════\n');
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error('FATAL:', e); process.exit(1); });

/**
 * Session and patient-scope regression checks for the isolated demo database.
 * Run with the API started and SEED_DEMO=1: node tests/session-security.mjs
 */
const BASE = process.env.TEST_API_BASE || 'http://127.0.0.1:4000/api';
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function staffLogin() {
  const result = await request('/auth/login', {
    method: 'POST', body: { username: 'admin', password: 'admin123' },
  });
  return { ...result, token: result.data.token };
}

async function patientLogin(patientNo = 'HM-1001') {
  const result = await request('/auth/patient-login', {
    method: 'POST', body: { patientNo, pin: '1234' },
  });
  return { ...result, token: result.data.token };
}

function claims(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

async function run() {
  const staff = await staffLogin();
  check('staff login succeeds', staff.status === 200 && Boolean(staff.token));
  const secondStaff = await staffLogin();
  check('each staff login receives a distinct session token',
    secondStaff.status === 200 && claims(staff.token).jti !== claims(secondStaff.token).jti);
  check('staff access token expires after eight hours',
    claims(staff.token).exp - claims(staff.token).iat === 8 * 60 * 60);

  const staffLogout = await request('/auth/logout', { method: 'POST', token: staff.token });
  check('staff logout acknowledges revocation', staffLogout.status === 200);
  const staffReplay = await request('/auth/me', { token: staff.token });
  check('revoked staff token cannot be replayed', staffReplay.status === 401);
  const freshStaff = await request('/auth/me', { token: secondStaff.token });
  check('logging out one device leaves its separate session active', freshStaff.status === 200);

  const patient = await patientLogin();
  check('patient login succeeds', patient.status === 200 && Boolean(patient.token));
  const own = await request('/portal/me', { token: patient.token });
  const tampered = await request('/portal/me?patient_id=HM-1002', { token: patient.token });
  check('portal reads the patient identity bound to its token',
    own.status === 200 && own.data.patient?.patient_no === 'HM-1001');
  check('changing a patient ID in the request cannot switch portal records',
    tampered.status === 200 && tampered.data.patient?.patient_no === 'HM-1001');

  const secondPatient = await patientLogin();
  const pinChange = await request('/portal/pin', {
    method: 'POST', token: patient.token,
    body: { current_pin: '1234', new_pin: '2345' },
  });
  check('patient can change their PIN', pinChange.status === 200);
  const siblingPatientReplay = await request('/portal/me', { token: secondPatient.token });
  check('changing a PIN revokes other patient sessions', siblingPatientReplay.status === 401);
  const currentPatientSession = await request('/portal/me', { token: patient.token });
  check('PIN change keeps the current patient flow active', currentPatientSession.status === 200);
  const pinRestore = await request('/portal/pin', {
    method: 'POST', token: patient.token,
    body: { current_pin: '2345', new_pin: '1234' },
  });
  check('patient can restore the demo PIN after the session check', pinRestore.status === 200);

  const patientLogout = await request('/auth/patient-logout', { method: 'POST', token: patient.token });
  check('patient logout acknowledges revocation', patientLogout.status === 200);
  const patientReplay = await request('/portal/me', { token: patient.token });
  check('revoked patient token cannot be replayed', patientReplay.status === 401);

  const receptionLogin = await request('/auth/login', {
    method: 'POST', body: { username: 'reception', password: 'reception' },
  });
  const otherProfile = await request('/patients/HM-1002', { token: receptionLogin.data.token });
  const profile = otherProfile.data.patient || {};
  check('reception can perform its profile workflow', otherProfile.status === 200);
  check('reception response omits clinical and national-ID fields',
    ['nin', 'nhis_no', 'blood_type', 'genotype', 'allergies', 'conditions', 'medications', 'notes']
      .every((field) => !(field in profile)));

  const count = await request('/patients/count', { token: receptionLogin.data.token });
  check('dashboard count endpoint returns only the aggregate',
    count.status === 200 && count.data.total >= 3 && Object.keys(count.data).length === 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * In-process CPU-profile harness: boots the app (1 worker, no cluster), fires a
 * realistic request mix, then exits cleanly so --cpu-prof writes a .cpuprofile.
 * Run: node --cpu-prof --cpu-prof-dir=<dir> tests/profile-harness.mjs
 */
import http from 'node:http';
import { createApp } from '../src/app.js';

const PORT = 4100;
const TOKENS = {};
const app = createApp();
const server = app.listen(PORT, '127.0.0.1');

async function req(method, path, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: '127.0.0.1', port: PORT, method, path,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    if (data) r.write(data);
    r.end();
  });
}

async function login(u, p) {
  const res = await new Promise((resolve) => {
    const data = JSON.stringify({ username: u, password: p });
    const r = http.request({
      host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/auth/login',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (rs) => { let b = ''; rs.on('data', (c) => b += c); rs.on('end', () => resolve(JSON.parse(b || '{}'))); });
    r.write(data); r.end();
  });
  return res.token;
}

await new Promise((r) => setTimeout(r, 800));
TOKENS.admin = await login('admin', 'admin123');
TOKENS.doctor = await login('dr.okafor', 'dr.okafor');
TOKENS.reception = await login('reception', 'reception');

const A = TOKENS.admin, D = TOKENS.doctor, R = TOKENS.reception;
const ops = [
  ['GET', '/api/patients', null, R],
  ['GET', '/api/departments', null, D],
  ['GET', '/api/staff', null, A],
  ['GET', '/api/patients', null, D],
  ['GET', '/api/reports/stats', null, A],
  ['GET', '/api/wards', null, R],
  ['GET', '/api/appointments', null, R],
  ['GET', '/api/inbox', null, D],
];

const N = 600;
for (let i = 0; i < N; i++) {
  const [m, p, b, t] = ops[i % ops.length];
  await req(m, p, b, t);
}

server.close(() => process.exit(0));
setTimeout(() => process.exit(0), 1500).unref();
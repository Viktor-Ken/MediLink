/**
 * Deep profiling load harness (dependency-free).
 * Sustained concurrent, authenticated, mixed-endpoint traffic with:
 *   - per-endpoint latency percentiles
 *   - event-loop delay (perf_hooks.monitorEventLoopDelay)
 *   - throughput + error accounting
 * Emits machine-readable JSON to --out.
 *
 * Usage:
 *   node deep-load.mjs --port 4100 --dur 20000 --conc 60 --out metrics.json
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i !== -1 ? process.argv[i + 1] : d;
};
const PORT = Number(arg('port', 4000));
const DUR = Number(arg('dur', 20000));
const CONC = Number(arg('conc', 60));
const OUT = arg('out', null);
const BASE = `http://127.0.0.1:${PORT}/api`;

const ROLES = [
  ['admin', 'admin123'], ['dr.okafor', 'dr.okafor'], ['er.nurse', 'er.nurse'],
  ['reception', 'reception'], ['pharmacist', 'pharmacist'], ['lab.scientist', 'lab.scientist'],
];

// Weighted, production-representative mix (reads dominate; a few writes).
// Each entry: [weight, method, pathBuilder(token, i)]
const MIX = [
  [30, 'GET', () => '/patients'],
  [8, 'GET', () => '/departments'],
  [8, 'GET', () => '/staff'],
  [10, 'GET', () => '/tasks?status=open'],
  [10, 'GET', () => '/referrals'],
  [6, 'GET', () => '/handoffs'],
  [8, 'GET', () => '/inbox/summary'],
  [5, 'GET', () => '/appointments'],
  [5, 'GET', () => '/wards'],
  [4, 'GET', () => '/prescriptions'],
  [4, 'GET', () => '/investigations'],
  [4, 'GET', () => '/notes'],
  [4, 'GET', () => '/visits'],
  [6, 'GET', () => '/reports/stats'],           // heavier aggregation
  [3, 'GET', () => '/reports/export/patients'], // CSV export
];
const TOTAL_W = MIX.reduce((s, m) => s + m[0], 0);
function pick(i) {
  let r = (i * 2654435761) % TOTAL_W; // deterministic-ish spread
  for (const m of MIX) { if (r < m[0]) return m; r -= m[0]; }
  return MIX[0];
}

async function login(u, p) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, password: p }),
  });
  if (r.status !== 200) throw new Error(`login ${u} -> ${r.status}`);
  return (await r.json()).token;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function main() {
  const tokens = [];
  for (const [u, p] of ROLES) { try { tokens.push(await login(u, p)); } catch (e) { console.error(e.message); } }
  if (!tokens.length) throw new Error('no tokens');
  console.error(`[deep-load] ${tokens.length} roles | port=${PORT} dur=${DUR}ms conc=${CONC}`);

  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable();

  const perEndpoint = new Map(); // key -> { count, lats[], statusCounts }
  let total = 0, ok = 0, denied = 0, err = 0;
  const allLats = [];
  const start = Date.now();
  let i = 0;

  async function worker() {
    while (Date.now() - start < DUR) {
      const [w, method, pathFn] = pick(i++);
      const token = tokens[i % tokens.length];
      const path = pathFn(token, i);
      const key = `${method} ${path.split('?')[0]}`;
      const t0 = performance.now();
      let status = 0;
      try {
        const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
        status = r.status;
        await r.arrayBuffer(); // drain
      } catch { status = -1; }
      const ms = performance.now() - t0;

      total++;
      if (status >= 200 && status < 300) ok++;
      else if (status === 403) denied++;
      else err++;
      allLats.push(ms);
      let e = perEndpoint.get(key);
      if (!e) { e = { count: 0, lats: [], statuses: {} }; perEndpoint.set(key, e); }
      e.count++; e.lats.push(ms);
      e.statuses[status] = (e.statuses[status] || 0) + 1;
      void w;
    }
  }

  await Promise.all(Array.from({ length: CONC }, () => worker()));
  const elapsedMs = Date.now() - start;
  h.disable();

  const endpoints = [...perEndpoint.entries()].map(([k, e]) => ({
    endpoint: k,
    count: e.count,
    p50: +pct(e.lats, 50).toFixed(1),
    p95: +pct(e.lats, 95).toFixed(1),
    p99: +pct(e.lats, 99).toFixed(1),
    statuses: e.statuses,
  })).sort((a, b) => b.count - a.count);

  const metrics = {
    config: { port: PORT, durationMs: DUR, concurrency: CONC, roles: tokens.length },
    elapsedMs,
    throughputRps: +((total / elapsedMs) * 1000).toFixed(1),
    requests: { total, ok, denied, err, errPct: +((err / total) * 100).toFixed(2) },
    latencyMs: { p50: +pct(allLats, 50).toFixed(1), p95: +pct(allLats, 95).toFixed(1), p99: +pct(allLats, 99).toFixed(1) },
    eventLoopDelayMs: {
      mean: +(h.mean / 1e6).toFixed(3),
      p99: +(h.percentile(99) / 1e6).toFixed(3),
      max: +(h.max / 1e6).toFixed(3),
    },
    endpoints,
    ts: new Date().toISOString(),
  };

  if (OUT) { writeFileSync(OUT, JSON.stringify(metrics, null, 2)); console.error(`[deep-load] wrote ${OUT}`); }
  console.log(JSON.stringify(metrics, null, 2));
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

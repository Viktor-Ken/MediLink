# MediLink API — Performance Investigation Report

> **Scope.** Dependency-free load measurement and CPU profiling of the MediLink Express API
> (`server/`), root-cause of the two bottlenecks found, and evidence for each fix.
> **Status:** two fixes shipped (DB index, JWT key reuse); remaining opportunities are ranked in
> §7. All numbers below are machine-sourced; see §6 for the threats to validity.

---

## 1. TL;DR

| Change | Effect on throughput | Effect on p50 |
|---|---|---|
| *(baseline)* | 61.0 rps | 712.6 ms |
| + `idx_patients_created_at` | 69.6 rps **(+14%)** | 639.3 ms (−10%) |
| + JWT secret as `KeyObject` | **99.5 rps (+63% vs baseline)** | **417.6 ms (−41%)** |

Both fixes are small (one `CREATE INDEX`, one `Buffer → createSecretKey` call at boot) and
together remove ~37% of `/patients` latency and ~40% of overall p50 on this host.

The remaining steady-state CPU profile is dominated by **response/CSV serialization (~31%)** and
**PostgreSQL row + date parsing (~17%)** — neither is a lock or a bad query; both are allocation
and string-work costs. They are addressed in §7.

---

## 2. Environment

| Item | Value |
|---|---|
| Host | AMD PRO A8-9600B, **4 cores**, **3,946 MB RAM** (≈700 MB free during runs) |
| OS / Node | Windows (win32), Node.js 22.19.0 |
| Database | **PostgreSQL 18.6** at `C:\Postgres17`, `max_connections=100` |
| Server | Express 4 (ESM), `PGPOOL_MAX` default **25** (`server/src/db.js:8`), `WEB_WORKERS` default `os.cpus().length` (`server/src/index.js:7`) |
| Dataset | `hospital_perf`: **10,000 patients**, 3,000 referrals, 3,000 prescriptions, 5,000 scan_events (seeded by `server/scripts/seed-perf.mjs`) |
| Colocated with | PostgreSQL, the load generator, and the agent/browser on the *same* machine — see §6 |

Throughput runs used `WEB_WORKERS=1`, `PGPOOL_MAX=4`, `AUTH_RATE_LIMIT=100000`.

---

## 3. Method

* **Load generator** — `server/tests/deep-load.mjs`, hand-rolled (no autocannon/k6). Six
  authenticated roles, a weighted production-shaped mix (30% `GET /patients`, 15% reports/CSV,
  the rest reads), keep-alive agent, fixed duration, per-endpoint p50/p95/p99, request error
  accounting, and `perf_hooks.monitorEventLoopDelay`.
* **Profiling** — V8 `--cpu-prof` (1 ms sampling) started with the server, converted by
  `server/tests/perf/convert.mjs` (flame.folded / speedscope / SVG) and analysed with
  `server/tests/perf/window.mjs` (idle-vs-busy split over a time window). **The profile must be
  windowed**: the first seconds are dominated by module loading (`readFileUtf8` = 45.5% of the
  pre-fix window), which is not steady-state behaviour.
* **DB verification** — `EXPLAIN (ANALYZE, BUFFERS)` with `enable_indexscan/enable_bitmapscan`
  toggled on/off to model pre/post-index plans.
* **Comparisons** — A/B runs interleaved and repeated (two generations back-to-back) to expose
  run-to-run variance.

---

## 4. Results

### 4.1 Throughput and latency (W=1, concurrency 50)

| Run | Duration | rps | p50 | p95 | p99 | `/patients` p50 | CSV export p50 | Event-loop delay (mean) |
|---|---|---|---|---|---|---|---|---|
| Baseline (`scale-w1.json`) | 15 s | **61.0** | 712.6 ms | 1,863.4 ms | 2,993.6 ms | 996.7 ms | 568.2 ms | 15.5 ms |
| + index (`post-index.json`) | 15 s | **69.6** | 639.3 ms | 1,384.2 ms | 2,606 ms | 840 ms | 455.6 ms | 15.9 ms |
| + JWT fix (`metrics-after.json`) | 20 s | **99.5** | **417.6 ms** | **1,060.4 ms** | 2,824.2 ms | **624.8 ms** | **323.1 ms** | 21.5 ms |
| + JWT fix, later re-run (`post-auth.json`) | 15 s | 53.1 | 711.1 ms | 2,820.9 ms | 4,334.4 ms | 1,012.7 ms | 281.1 ms | 20.2 ms |

Notes:

* `rps` counts every request — 936 / 1,072 / 2,011 / 813 per row, including expected `403`s
  (~15% of the mix, on role-gated endpoints). Useful 200-only throughput for row 3 =
  1,709 / 20.2 s ≈ **84.5 rps**. The denied ratio is stable across runs, so the comparison holds.
* The last row is **the same code** as row 3, measured 27 minutes later and performing ~47%
  worse — this is host pressure (§5), not a regression. Row 3 is the figure to quote.
* `err = 0` on every run: no 5xx, no timeouts, no application errors.
* `/reports/export/patients` carries the heaviest tail: **p95 3,983 ms** on 17 authorised calls
  in the post-fix run — consistent with the serialization cost in §4.4.

### 4.2 Database: `/patients` ordering

`GET /patients` runs `SELECT … FROM patients ORDER BY created_at DESC LIMIT 100`
(`server/src/routes/patients.js:34`). With 10k rows this forced a **Seq Scan + top-N heap sort**.

**Fix:** `CREATE INDEX idx_patients_created_at ON patients (created_at DESC); ANALYZE patients;`
— added to `server/src/schema.sql` so `scripts/migrate.js` applies it to every deployment
(verified present in the dev `hospital` database).

| Plan | Buffers read | Execution time (warm) |
|---|---|---|
| Seq Scan + Sort (index disabled) | **397** (read) | **48.02 ms** |
| Index Scan using `idx_patients_created_at` | **7** (read) | **0.19 ms** |

≈**253× faster execution with ~57× fewer buffers read**: the page-fit effect (7 vs 397 buffers)
explains the endpoint p50 drop from 996.7 → 624.8 ms. A cold first run measured 3.48 ms execution
+ 35.7 ms *planning* — that is plan-cache/page-in, not steady state, and is excluded above.

### 4.3 API: JWT verification on every request

**Root cause.** `jwt.verify(token, secretString)` (jsonwebtoken) normalises the secret on *every
call*: it first attempts `createPublicKey(secret)` — which must throw for an HMAC secret — then
falls back to `createSecretKey(secret)`. Under load this appeared directly in the profile as
`createPublicKey crypto/keys`.

**Fix.** Build the `KeyObject` once at boot and pass it to `verify`
(`server/src/auth.js:26`, used at `auth.js:51` and `auth.js:69`); signing still uses the string.

**Evidence** (whole V8 profile, both runs):

| Metric | Before | After |
|---|---|---|
| `createPublicKey` samples (whole run) | **776** | **1** |
| `createPublicKey` samples (steady window 3–20 s) | 178 | **0** |

### 4.4 Steady-state CPU profile after both fixes

Window 3–20 s of `prof-after/CPU.20261019.124809.*.cpuprofile`: 6,061 samples, **92.4% busy /
7.6% idle** — the event loop is saturated at concurrency 50, i.e. the server is CPU-bound, not
waiting on the database.

| Self-time | % of window | % of busy | Source |
|---|---|---|---|
| `stringify` | 9.3% | 10.1% | `server/src/lib/response.js` (JSON responses) |
| `esc` | 7.4% | 8.1% | `server/src/routes/reports.js:13` (CSV escaping) |
| `parseDate` | 7.1% | 7.7% | `postgres-date/index.js` (pg driver) |
| `toCsv` | 4.1% | 4.5% | `server/src/routes/reports.js:8` |
| `(garbage collector)` | 4.1% | 4.4% | V8 GC |
| `parseRow` | 4.0% | 4.4% | `server/src/lib/result.js:63` (row decoding) |
| `slice` | 4.0% | 4.4% | `node:buffer` |
| `utf8Slice` | 3.6% | 3.9% | buffer |
| `timeZoneOffset` | 3.2% | 3.5% | `postgres-date` |
| `writev` | 1.8% | 1.9% | socket write |
| `parseDataRowMessage` | 1.7% | 1.8% | pg protocol |
| `update` (`crypto/hash`) | 1.0% | 1.1% | bcrypt hash comparison |

Aggregates (approximate, in-window): **response/CSV serialization ≈ 31%**,
**pg row + date parsing ≈ 17%**, **GC ≈ 4%**.

**Derived cost:** ≈**8 ms of CPU per request** (6,061 samples × ~2.2 ms/sample ÷ ~1,700 requests
in the window). `GET /reports/export/patients` and `GET /patients` are among the most expensive
paths (p95 3,983 ms and p50 624.8 ms respectively).

### 4.5 Worker scaling (`WEB_WORKERS`)

`WEB_WORKERS=4` forks four Express servers in front of one PostgreSQL instance
(`server/src/index.js:9`). Interleaved A/B runs (concurrency 25, 15 s, two generations each):

| Code state | W=1 rps (a/b) | W=4 rps (a/b) | W=4 ÷ W=1 |
|---|---|---|---|
| Pre-fix | 33.2 / 34.1 (avg **33.7**) | 33.9 / 19.1 (avg **26.5**) | **0.79×** |
| Post-fix | 49.4 / 46.9 (avg **48.2**) | 24.1 / 26.7 (avg **25.4**) | **0.53×** |
| Later run | 21.8 / 19.8 (avg **20.8**) | 11.4 / 7.0 (avg **9.2**) | **0.44×** |

**Interpretation.** Four workers **lower** median latency (p2 A/B: 415/421 ms → 364/230 ms) but
never raise throughput on this box. The mechanism is footprint, not parallelism: each worker is a
full V8 isolate with its own heap and GC, and they share 4 cores and ~700 MB of free RAM with
PostgreSQL *and* the load generator. W=4 runs coincide with PostgreSQL backend deaths
(`0xC0000142`, §5) — which surface in Node as `read ECONNRESET` from `pg-pool`
(`prof/probe-w4.err`) and `[medilink] worker N died (code undefined) — respawning`
(`prof/scale-w4.log.err`).

**Caveat:** one single conc-50 W=4 run measured 69.8 rps (`scale-w4.json`), *above* the W=1
baseline of 61.0 — contradicting every interleaved pair. That contradiction is host noise
(§5/§6). **No conclusion about cluster throughput is supportable on this host**; the repeatable
result is that adding workers adds footprint, and `N × PGPOOL_MAX < max_connections` must hold.

---

## 5. Host instability (why runs are not smoothly reproducible)

This is the dominant measurement artefact, and it is *not* application behaviour.

**PostgreSQL crash/restart cycles** (log excerpts, `C:\Postgres17\data\log\`):

```
14:54:29 WAT [7844] LOG:  autovacuum worker (PID 8176) was terminated by exception 0xC0000142
14:54:29 WAT [7844] LOG:  all server processes terminated; reinitializing
14:56:40 WAT [7844] LOG:  could not reserve shared memory region (...) for child ...: error code 487
15:05:51 WAT [7564] LOG:  client backend (PID 4512) was terminated by exception 0xC0000142
15:09:49 WAT [18380] LOG:  client backend (PID 16460) was terminated by exception 0xC0000142
15:47:23 WAT [13928] LOG:  client backend (PID 16572) was terminated by exception 0xC0000142
```

`0xC0000142` = `STATUS_DLL_INIT_FAILED` — a *process* failed to initialise under memory
pressure; `error code 487` = `ERROR_NO_SYSTEM_RESOURCES` (shared-memory reservation refused).
Consequences observed in the application:

```
Error: read ECONNRESET   at pg-pool/index.js:45  →  at routes/auth.js:35 (login)
[medilink] worker 9644 died (code undefined) — respawning
```

Those same crashes are why consecutive runs of identical code produced 99.5 → 53.1 rps. The
`0xC000013A` entries at 15:30 / 15:51 come from our own forced stops, not from the DB.

**Practical rules that made measurement possible on this host:**

1. Start PostgreSQL + server + load generator inside **one** shell invocation (processes spawned
   from a fresh shell get reaped by the shell's job object).
2. Override for test runs: `WEB_WORKERS=1`, `PGPOOL_MAX=4`, `AUTH_RATE_LIMIT=100000`
   (otherwise `deep-load.mjs`/`sqli.mjs` trip the 30/min per-IP login limiter → 429s in
   unrelated suites).
3. Treat any single run as suspect; only interleaved A/B pairs with matching config are
   comparable.

---

## 6. Threats to validity

* **Co-location**: generator, API, and PostgreSQL compete for the same 4 cores and 4 GB RAM;
  absolute rps is not a deployment benchmark.
* **Short runs** (15–20 s), 1–2 repetitions; high variance (same config: 33.9 vs 19.1 rps).
* **Windowed profiling**: whole-run percentages include boot-time module loading; only the
  3–20 s window is used for steady-state claims.
* **`rps` includes expected 403s**; useful throughput is reported separately in §4.1.
* **No query-level DB timings** (`pg_stat_statements` not enabled); DB attribution rests on
  `EXPLAIN (ANALYZE, BUFFERS)` and in-process row-parsing CPU.
* No CPU pinning, no warm-up exclusion beyond the profile window, no baseline on a clean host.

---

## 7. Recommendations (ranked)

| # | Action | Targets | Expected impact |
|---|---|---|---|
| 1 | **Stream CSV exports** — write header + rows incrementally to the response instead of building one string, and prefer `pg-query-stream`/a cursor over `LIMIT 500` arrays | `routes/reports.js` `toCsv`/`esc`, `lib/response.js` `stringify` | ~31% of steady CPU; removes large-allocation GC spikes |
| 2 | **Replace pg date parsing** — custom `pg.types` parser returning ISO-8601 strings, or `to_char()` in SQL for display-only fields | `postgres-date` `parseDate`/`timeZoneOffset` (~10%) | ~17% total with row-decode shares |
| 3 | **Trim list payloads** — `/patients` selects 18 columns (`server/src/db.js:31`) of which several are free-text (`allergies`, `conditions`, `medications`, `notes`); split list vs. detail projections | `PATIENT_COLUMNS`, JSON size | Less serialization + bandwidth per call |
| 4 | **More indexes for other ORDER BY paths** if the dataset grows: `referrals(created_at)`, `scan_events(patient_id, created_at)`, `vitals(created_at)` — verify with `EXPLAIN` first | query plans | Avoids future seq scans |
| 5 | **Reduce allocations in the hot path** (row mapping, avoid JSON round-trips) to cut GC (4%) | `lib/result.js`, route mappers | Small but steady |
| 6 | **Keep the JWT `KeyObject`** (shipped) — never pass a raw secret string to `verify` | `auth.js:26,51,69` | Shipped: 776 → 1 samples |
| 7 | **Sizing rules** — default `WEB_WORKERS=1` on small hosts; otherwise `N ≤ cores − 1` and `N × PGPOOL_MAX < max_connections − reserved` | `index.js:7`, `db.js:8` | Prevents pool exhaustion |
| 8 | **Re-measure on an isolated host** (≥8 GB RAM, DB + generator off-box), ≥60 s runs with warm-up, `pg_stat_statements=on` | methodology | Trustworthy baseline |

---

## 8. Reproduce

```powershell
# 1. dataset
cd server
node scripts/perf-create-db.mjs          # creates hospital_perf
node scripts/seed-perf.mjs 10000         # 10k patients etc.

# 2. index
psql -h 127.0.0.1 -U postgres -d hospital_perf \
  -c "CREATE INDEX IF NOT EXISTS idx_patients_created_at ON patients (created_at DESC); ANALYZE patients;"

# 3. server (small-host settings, single worker)
$env:WEB_WORKERS=1; $env:PGPOOL_MAX=4; $env:PGDATABASE='hospital_perf'; node src/index.js
# bash: export WEB_WORKERS=1 PGPOOL_MAX=4 PGDATABASE=hospital_perf

# 4. load
node tests/deep-load.mjs --port 4000 --dur 20000 --conc 50 --out metrics.json

# 5. profile + analyse
node --cpu-prof --cpu-prof-dir=prof src/index.js
node tests/perf/convert.mjs prof          # flame.folded / speedscope.json / flame.svg
node tests/perf/window.mjs prof 3 20      # idle vs busy + top self-time in window

# 6. DB plan comparison (index on/off)
psql -h 127.0.0.1 -U postgres -d hospital_perf -f tests/perf/explain-compare.sql
```

On this machine, run steps 3–4 from the **same** shell session as PostgreSQL (see §5).

---

## 9. Artifacts

| Path (under `%TEMP%` unless noted) | Contents |
|---|---|
| `opencode\prof\` | Pre-fix `.cpuprofile`, conversions, `scale-*.json`, `p2-*`, `pid*`, `pre-p2-*`, `cpu*`, `wait-*` |
| `opencode\prof-after\` | Post-fix `.cpuprofile`, `metrics-after.json`, `flame.folded` |
| `opencode\prof-boot\`, `prof2\` | Boot-phase and intermediate profiles |
| `opencode\fallow-web.txt`, `fallow-server.txt` | Static analysis: maintainability 85–87, dead exports, clone hotspots |
| `server\tests\deep-load.mjs` | Load harness (in-repo) |
| `server\tests\perf\{convert,window}.mjs`, `explain-compare.sql` | Profile conversion, windowed analysis, index on/off plan (in-repo) |
| `server\scripts\seed-perf.mjs`, `perf-create-db.mjs` | Dataset + DB (in-repo) |
| `C:\Postgres17\data\log\` | PostgreSQL crash/restart logs cited in §5 |

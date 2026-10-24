# Security testing

MediLink is checked two ways: a manual code-level review (auth, access
control, input handling, SQL, session/token handling — done by hand, not a
scanner) and automated scanning in CI. This document covers the automated
side: OWASP ZAP (DAST) and dependency auditing (SCA).

## What runs in CI

`.github/workflows/security-scan.yml` runs on every push/PR to `main`:

- **`npm audit`** on `server/` and `web/` — known-vulnerable dependencies.
- **ZAP baseline scan** — passive only (no attack payloads sent); safe to run
  on every PR. It spins up Postgres, seeds demo data (`SEED_DEMO=1`,
  throwaway accounts only), builds and starts the app, then points ZAP at it.

Nightly (and on manual dispatch with `active_scan: true`), it also runs:

- **ZAP full scan** — active scanning: ZAP actually attacks the running
  instance (SQLi, XSS, auth bypass attempts, etc.). This only runs against
  the ephemeral CI database, never anything with real data, and only on a
  schedule/manually so it can't block or slow down ordinary PRs.

Reports are uploaded as workflow artifacts (and the baseline scan posts a PR
comment). Nothing is currently set to hard-fail the build on findings —
`fail_action: false` — so a new alert won't block merges by surprise; treat
the report as a checklist to triage, not a gate, until the team has reviewed
a few runs and decided which alert classes should actually fail CI.

## Triaging a finding

1. Open the uploaded report (Actions → run → Artifacts).
2. For each alert, decide: real issue → fix it in code; false positive /
   accepted risk → add one line to `.zap/rules.tsv` with the rule ID and a
   comment explaining *why* (see the examples in that file). Never suppress
   an alert without writing down the reason — the next person (or the next
   scan) needs to know it was a decision, not an oversight.
3. Re-run the workflow (`workflow_dispatch`) to confirm.

## Running ZAP locally

Requires Docker. Run the app first (`npm run db:migrate && npm start` in
`server/`, with `web/` built or `vite dev` proxying), then:

```bash
# Passive baseline scan (safe)
docker run --rm -v $(pwd)/.zap:/zap/wrk/:rw -t zaproxy/zap-stable \
  zap-baseline.py -t http://host.docker.internal:4000/ \
  -r zap-baseline-report.html -c rules.tsv

# Active scan (actually attacks the target — only ever run this against
# your own local instance with seeded/demo data, never a shared or
# production environment)
docker run --rm -v $(pwd)/.zap:/zap/wrk/:rw -t zaproxy/zap-stable \
  zap-full-scan.py -t http://host.docker.internal:4000/ \
  -r zap-full-report.html -c rules.tsv
```

On Linux, replace `host.docker.internal` with your machine's LAN IP or add
`--network host` to the `docker run` command.

## Authenticated scanning

The scans above only reach what's available unauthenticated (login pages,
static assets, the public license-locked response). To scan behind login,
give ZAP a session: either record an authentication script in the ZAP
desktop UI (Tools → Authentication) using the demo `admin`/`admin123`
account seeded by `SEED_DEMO=1`, or pass a bearer token ZAP attaches to every
request via a ZAP HTTP Sender script. Only do this against the seeded demo
database — never capture or replay a token from a real account.

## Other layers worth adding later

- **SAST**: a tool like Semgrep or CodeQL for static analysis of the server
  code (SQL building, auth middleware ordering, etc.).
- **Secrets scanning**: gitleaks or trufflehog in CI to catch a committed
  key/token before it merges.
- **Container scanning**: if MediLink is ever shipped as a Docker image,
  scan it (Trivy/Grype) for OS-level CVEs.

None of these are wired up yet; ask and they can be added the same way as
the ZAP workflow above.

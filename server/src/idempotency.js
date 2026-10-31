import pool from './db.js';

// How long a completed response stays cached. Long enough to cover a client
// retrying after a slow response/timeout, short enough that the table
// doesn't grow forever.
const RESPONSE_TTL_MS = 24 * 60 * 60_000;
// If a row's response is still NULL after this long, treat it as abandoned
// (the server that owned it crashed or errored without cleaning up) rather
// than blocking every future retry of that key forever.
const IN_FLIGHT_STALE_MS = 2 * 60_000;

let sweepStarted = false;
function startSweep() {
  if (sweepStarted) return;
  sweepStarted = true;
  setInterval(() => {
    pool.query(
      `DELETE FROM idempotency_keys
       WHERE (response_status IS NOT NULL AND created_at < now() - make_interval(secs => $1))
          OR (response_status IS NULL AND created_at < now() - make_interval(secs => $2))`,
      [RESPONSE_TTL_MS / 1000, IN_FLIGHT_STALE_MS / 1000],
    ).catch(() => {});
  }, 10 * 60_000).unref();
}

/**
 * Opt-in idempotency for a POST that creates a resource. A client sends an
 * `Idempotency-Key` header; retrying the same request with the same key
 * either replays the original response or, if that request is still being
 * processed, gets a 409 instead of double-creating the resource. Requests
 * without the header are unaffected — this never requires clients to use it.
 *
 * `scope` namespaces the key per-route so the same header value from two
 * different endpoints (or two different staff members) can't collide.
 */
export function idempotent(scope) {
  startSweep();
  return async (req, res, next) => {
    const header = req.headers['idempotency-key'];
    if (!header || typeof header !== 'string' || !header.trim()) return next();

    const key = `${scope}:${req.staff?.id || req.patientId || 'anon'}:${header.trim().slice(0, 200)}`;

    try {
      const ins = await pool.query(
        `INSERT INTO idempotency_keys (key) VALUES ($1)
         ON CONFLICT (key) DO NOTHING
         RETURNING key`,
        [key],
      );

      if (!ins.rows[0]) {
        // Someone (possibly this same client, retrying) already owns this
        // key. If it finished, replay it; otherwise it's genuinely in
        // flight (or was abandoned and not yet swept) — don't double-run
        // the handler either way.
        const { rows } = await pool.query(
          'SELECT response_status, response_body FROM idempotency_keys WHERE key = $1',
          [key],
        );
        const cached = rows[0];
        if (cached?.response_status) {
          return res.status(cached.response_status).json(cached.response_body);
        }
        return res.status(409).json({
          error: 'A request with this Idempotency-Key is already being processed',
        });
      }

      const originalJson = res.json.bind(res);
      res.json = (body) => {
        // Only cache a successful creation. An error response is not
        // cached, so a legitimate retry after a real failure can go
        // through normally instead of being stuck replaying the failure.
        if (res.statusCode >= 200 && res.statusCode < 300) {
          pool.query(
            'UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE key = $3',
            [res.statusCode, JSON.stringify(body), key],
          ).catch(() => {});
        } else {
          pool.query('DELETE FROM idempotency_keys WHERE key = $1', [key]).catch(() => {});
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      // Idempotency bookkeeping failing should never block the actual
      // request — fail open.
      next();
    }
  };
}

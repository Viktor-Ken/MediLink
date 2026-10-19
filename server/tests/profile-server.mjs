/**
 * Single-process profiling server: boots the real Express app (same createApp as
 * production, minus the cluster wrapper) and exits CLEANLY after --run-for ms so
 * `node --cpu-prof` flushes a .cpuprofile on exit.
 *
 *   node --cpu-prof --cpu-prof-dir=DIR profile-server.mjs --port 4100 --run-for 25000
 */
import { createApp } from '../src/app.js';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i !== -1 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 4100));
const RUN_FOR = Number(arg('run-for', 25000));

const app = createApp();
const server = app.listen(PORT, '127.0.0.1', () => {
  console.error(`[profile-server] listening on ${PORT}, will exit in ${RUN_FOR}ms`);
});

setTimeout(() => {
  console.error('[profile-server] window complete, shutting down cleanly');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}, RUN_FOR);

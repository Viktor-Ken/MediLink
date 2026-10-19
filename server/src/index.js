import cluster from 'cluster';
import os from 'os';
import { createApp } from './app.js';

const PORT   = Number(process.env.PORT || 4000);
const HOST   = process.env.HOST || '0.0.0.0';
const WORKERS = Math.max(1, Number(process.env.WEB_WORKERS ?? os.cpus().length));

if (WORKERS > 1 && cluster.isPrimary) {
  console.log(`[medilink] primary ${process.pid} — launching ${WORKERS} workers`);
  for (let i = 0; i < WORKERS; i++) cluster.fork();
  cluster.on('exit', (w) => {
    console.error(`[medilink] worker ${w.process.pid} died (code ${w.exitCode}) — respawning`);
    cluster.fork();
  });
  ['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => {
    for (const w of Object.values(cluster.workers)) w.process.kill();
    process.exit(0);
  }));
} else {
  const app    = createApp();
  const server = app.listen(PORT, HOST, () => {
    console.log(`[medilink] worker ${process.pid} listening on http://${HOST}:${PORT}`);
  });
  server.requestTimeout   = 65_000;
  server.keepAliveTimeout = 30_000;
  server.headersTimeout   = 65_000;
}

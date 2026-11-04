// Stages a self-contained copy of the server code and the built web client
// inside desktop/resources, in the same relative layout the server already
// expects (server/src/app.js resolves the web build as ../../web/dist from
// itself) — so app.js needs zero changes to run packaged inside Electron.
// Run before `npm run start` or `npm run dist` in this folder.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, '..');
const repoRoot = join(desktopRoot, '..');
const resources = join(desktopRoot, 'resources');

const serverSrc = join(repoRoot, 'server');
const webDistSrc = join(repoRoot, 'web', 'dist');
const serverDest = join(resources, 'server');
const webDistDest = join(resources, 'web', 'dist');

if (!existsSync(webDistSrc)) {
  console.error(
    'web/dist not found. Run `npm run build` in web/ first (desktop app bundles the ' +
    'production web build, not the Vite dev server).',
  );
  process.exit(1);
}

rmSync(resources, { recursive: true, force: true });
mkdirSync(resources, { recursive: true });

// Server code, minus node_modules (desktop/node_modules supplies the runtime
// deps instead — see package.json) and any local .env (the packaged app must
// never ship a developer's real secrets; see main.js for how config is loaded
// at runtime instead).
cpSync(serverSrc, serverDest, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(serverSrc.length);
    if (rel.startsWith('/node_modules') || rel === '/node_modules') return false;
    if (rel === '/.env') return false;
    return true;
  },
});

cpSync(webDistSrc, webDistDest, { recursive: true });

console.log('Staged server + web/dist into desktop/resources/');

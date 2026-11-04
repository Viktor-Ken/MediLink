// Builds web/ with VITE_API_BASE_URL baked in, so the resulting dist — the
// bundle `npx cap sync` copies into the native Android/iOS projects — calls
// out to your deployed API instead of a same-origin server that doesn't
// exist on a phone. Configure the URL in mobile/.env (copy .env.example) or
// pass it inline: MEDILINK_API_BASE_URL=https://api.example.com npm run build-web
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(__dirname, '..');
const webRoot = join(mobileRoot, '..', 'web');

const envPath = join(mobileRoot, '.env');
const fileEnv = existsSync(envPath) ? dotenv.parse(readFileSync(envPath, 'utf8')) : {};
const apiBase = process.env.MEDILINK_API_BASE_URL || fileEnv.MEDILINK_API_BASE_URL;

if (!apiBase) {
  console.error(
    'MEDILINK_API_BASE_URL is not set. Copy mobile/.env.example to mobile/.env and set it ' +
    'to your deployed API\'s URL (e.g. https://api.example.com), or pass it inline:\n' +
    '  MEDILINK_API_BASE_URL=https://api.example.com npm run build-web',
  );
  process.exit(1);
}

console.log(`Building web/ with VITE_API_BASE_URL=${apiBase} ...`);
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCmd, ['run', 'build'], {
  cwd: webRoot,
  env: { ...process.env, VITE_API_BASE_URL: apiBase },
  stdio: 'inherit',
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

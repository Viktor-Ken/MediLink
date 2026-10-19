/**
 * Mint a MediLink license token (vendor-only, run on your machine).
 *
 *   node scripts/make-license.js <priv.pem> <YYYY-MM-DD> [--bind <fingerprint>]
 *
 * Token = exp.kid.machineFingerprint.signature
 *   - omit --bind   -> portable token (works on any machine; first run binds it)
 *   - with --bind   -> hard-bound to one machine (get its fingerprint via
 *                      node scripts/license-fingerprint.js on that machine)
 * Private key stays with you; the app verifies with the EMBEDDED public key.
 */
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const privFile = args[0];
const expiry = args[1];
const bindIdx = args.indexOf('--bind');
const mf = bindIdx !== -1 ? args[bindIdx + 1] : '';

if (!privFile || !/^\d{4}-\d{2}-\d{2}$/.test(expiry || '')) {
  console.error('Usage: node scripts/make-license.js <priv.pem> <YYYY-MM-DD> [--bind <fingerprint>]');
  process.exit(1);
}
if (mf && !/^[0-9a-f]{32}$/.test(mf)) {
  console.error('--bind expects a 32-hex fingerprint (run license-fingerprint.js on the target machine).');
  process.exit(1);
}

const priv = readFileSync(privFile, 'utf8');
const kid = 'k1';
const sig = sign('sha256', Buffer.from(`${expiry}.${kid}.${mf}`), priv).toString('base64url');

console.log(`LICENSE_TOKEN=${expiry}.${kid}.${mf}.${sig}`);
console.log('Put that in the recipient\'s server/license.txt (or server/.env as LICENSE_TOKEN=...).');
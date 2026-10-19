/**
 * Generate the ECDSA P-256 license keypair (vendor only, run ONCE).
 *
 *   node scripts/make-license-key.js <dir>
 *
 * Writes dir/license-priv.pem (KEEP PRIVATE — never ship, never commit) and
 * dir/license.pub (ship this to the recipient as server/license.pub).
 */
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/make-license-key.js <output-dir>');
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
});

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'license-priv.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
writeFileSync(join(dir, 'license.pub'), publicKey.export({ type: 'spki', format: 'pem' }));

console.log(`Wrote ${join(dir, 'license-priv.pem')}  (PRIVATE — keep secret)`
  + `\nWrote    ${join(dir, 'license.pub')}  (PUBLIC — ship as server/license.pub)`);
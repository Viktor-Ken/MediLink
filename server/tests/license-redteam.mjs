/**
 * Red-team harness for the MediLink license gate.
 * Each case simulates an attacker WITH the source. Every attack must FAIL CLOSED.
 * Usage: node tests/license-redteam.mjs
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sign } from 'node:crypto';

const SRC = new URL('../src/license.js', import.meta.url).href;
const PRIV = 'C:/Users/HP/Downloads/MediLink-License-Keys/license-priv.pem';
const PUB = 'C:/Users/HP/Downloads/MediLink-License-Keys/license.pub';
const dir = mkdtempSync(join(tmpdir(), 'lic-rt-'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got=${got}, want=${want})`);
};

// Run evaluateLicense in a fresh child process with given env, print locked state.
function run(env) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    process.env.LICENSE_STATE_FILE=${JSON.stringify(env.state)};
    process.env.LICENSE_TOKEN_FILE=${JSON.stringify(join(dir, 'no-such-token.txt'))};
    if (${JSON.stringify(!!env.token)}) process.env.LICENSE_TOKEN=${JSON.stringify(env.token)};
    const m = await import(${JSON.stringify(SRC)} + '?t=' + Date.now() + Math.random());
    const now = ${JSON.stringify(env.now || null)} ? new Date(${JSON.stringify(env.now || null)}) : new Date();
    const r = m.evaluateLicense(now);
    console.log(r.locked ? 'LOCKED:'+r.reason : 'UNLOCKED');
  `], { encoding: 'utf8', cwd: dir });
  const out = (r.stdout || '').trim().split('\n').pop();
  return out;
}

// Mint a token (kid=k1, given mf)
function mint(exp, mf = '') {
  const priv = readFileSync(PRIV, 'utf8');
  const sig = sign('sha256', Buffer.from(`${exp}.k1.${mf}`), priv).toString('base64url');
  return `${exp}.k1.${mf}.${sig}`;
}

const FUTURE = '2099-12-31';
const PAST = '2020-01-01';

// 1. Legit portable token, first run -> UNLOCKED
check('legit token (first run) unlocks', run({ state: join(dir, 's1'), token: mint(FUTURE) }), 'UNLOCKED');

// 2. Tampered expiry (date edited, sig unchanged) -> LOCKED
const t = mint(FUTURE);
const tamperedDate = t.replace('2099', '2999');
check('tampered expiry date -> locked', run({ state: join(dir, 's2'), token: tamperedDate }).startsWith('LOCKED'), true);

// 3. Re-signed with attacker key (mf empty) -> LOCKED (embedded anchor ignores it)
//    (simulate by a token with kid=k9 / unknown key)
const fakeKid = `${FUTURE}.k9..${'AAAA'}`;
check('re-signed with own key -> locked', run({ state: join(dir, 's3'), token: fakeKid }).startsWith('LOCKED'), true);

// 4. Deleted token -> LOCKED (fail-closed)
check('no token present -> locked', run({ state: join(dir, 's4'), token: '' }).startsWith('LOCKED'), true);

// 5. Copied to another machine (token hard-bound to a different fp) -> LOCKED
check('token bound to other machine -> locked', run({ state: join(dir, 's5'), token: mint(FUTURE, 'deadbeef'.repeat(4)) }).startsWith('LOCKED'), true);

// 6. Clock rolled back (state.lastSeen in the future) -> LOCKED
const s6 = join(dir, 's6');
writeFileSync(s6, JSON.stringify({ boundFp: null, lastSeen: Date.now() + 7 * 86400000 }));
check('clock rolled back -> locked', run({ state: s6, token: mint(FUTURE) }).startsWith('LOCKED'), true);

// 7. Expired token (real past date) -> LOCKED
check('expired token -> locked', run({ state: join(dir, 's7'), token: mint(PAST) }).startsWith('LOCKED'), true);

// 8. Copy-folder attack: run once (binds), then a 2nd process with a DIFFERENT bound fp -> LOCKED
const s8 = join(dir, 's8');
run({ state: s8, token: mint(FUTURE) }); // binds s8 to this machine's fp
check('second machine after bind -> locked', run({ state: s8, token: mint(FUTURE, 'ffffffff'.repeat(4)) }).startsWith('LOCKED'), true);

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
process.exit(fail ? 1 : 0);
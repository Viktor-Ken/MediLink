import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const startS = Number(process.argv[3] ?? 0);
const endS = Number(process.argv[4] ?? Infinity);
const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
const p = JSON.parse(readFileSync(join(dir, file), 'utf8'));
const nodes = new Map(p.nodes.map((n) => [n.id, n]));

function info(id) {
  const cf = nodes.get(id).callFrame;
  const url = (cf.url || '').replace(/^file:\/\//, '');
  const short = url.split('/').slice(-2).join('/') || '(native)';
  return { name: cf.functionName || '(anonymous)', file: short };
}

const IDLE = new Set(['(idle)', '(program)']);
let t = 0;
const inWindow = [];
for (let i = 0; i < p.samples.length; i++) {
  t += p.timeDeltas[i] || 0;
  const s = t / 1e6;
  if (s >= startS && s <= endS) inWindow.push(p.samples[i]);
}
const n = inWindow.length;
const idle = inWindow.filter((id) => IDLE.has(info(id).name)).length;
const self = new Map();
for (const id of inWindow) { const k = `${info(id).name} ${info(id).file}`; self.set(k, (self.get(k) || 0) + 1); }

console.log(`profile ${file}: total samples ${p.samples.length}, duration ${(t / 1e6).toFixed(1)}s`);
console.log(`window ${startS}-${endS}s: ${n} samples, idle ${idle} (${((100 * idle) / n).toFixed(1)}%), busy ${(100 - (100 * idle) / n).toFixed(1)}%`);
console.log('\n== HOT SELF-TIME IN WINDOW ==');
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) {
  console.log(`  ${((100 * v) / n).toFixed(1).padStart(5)}%  ${k}`);
}
const busy = n - idle;
console.log('\n== SHARE OF BUSY (idle excluded) ==');
for (const [k, v] of [...self].filter(([k]) => !k.startsWith('(idle)') && !k.startsWith('(program)')).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${((100 * v) / busy).toFixed(1).padStart(5)}%  ${k}`);
}
const cpk = [...self].filter(([k]) => k.includes('createPublicKey')).reduce((a, [, v]) => a + v, 0);
console.log(`\ncreatePublicKey samples in window: ${cpk}`);

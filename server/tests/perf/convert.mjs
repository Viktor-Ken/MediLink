import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
if (!file) { console.error('no .cpuprofile in ' + dir); process.exit(1); }
const p = JSON.parse(readFileSync(join(dir, file), 'utf8'));

const nodes = new Map(p.nodes.map((n) => [n.id, n]));
// V8 cpuprofile is TOP-DOWN: nodes carry `children` (no `parent` field).
const parent = new Map();
for (const n of p.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
const totalSamples = p.samples.length;

function info(n) {
  const cf = n.callFrame;
  const fn = cf.functionName || '(anonymous)';
  const raw = (cf.url || '').replace(/^file:\/\//, '');
  const short = raw.split('/').slice(-2).join('/') || '(native)';
  return { name: fn, file: short, key: `${fn} ${short}:${cf.lineNumber + 1}` };
}
function stackOf(id) {
  const a = [];
  let c = id;
  while (c !== undefined) {
    const n = nodes.get(c);
    if (!n) break;
    const fn = n.callFrame.functionName;
    if (fn === '(root)') break;      // synthetic top: exclude
    a.push(info(n).key);
    c = parent.get(c);
  }
  return a.reverse();
}

// ---- tree (for folded + SVG) ----
const root = { name: 'root', children: new Map(), count: 0 };
for (const sid of p.samples) {
  const st = stackOf(sid);
  let n = root; n.count++;
  for (const f of st) {
    if (!n.children.has(f)) n.children.set(f, { name: f, children: new Map(), count: 0 });
    n = n.children.get(f); n.count++;
  }
}

// ---- folded ----
const folded = [];
(function walk(n, path) {
  if (n.name !== 'root') folded.push(`${[...path, n.name].join(';')} ${n.count}`);
  const kids = [...n.children.values()].sort((a, b) => b.count - a.count);
  for (const k of kids) walk(k, n.name === 'root' ? path : [...path, n.name]);
})(root, []);
writeFileSync(join(dir, 'flame.folded'), folded.join('\n'));

// ---- top self time (leaves) ----
const leaf = new Map();
for (const sid of p.samples) { const k = info(nodes.get(sid)).key; leaf.set(k, (leaf.get(k) || 0) + 1); }
const topLeaf = [...leaf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);

const byUrl = new Map();
for (const n of p.nodes) {
  const u = info(n).file || '(native)';
  byUrl.set(u, (byUrl.get(u) || 0) + (n.hitCount || 0));
}
const topUrl = [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

console.log(`profile: ${file}`);
console.log(`samples: ${totalSamples}  duration: ${((p.endTime - p.startTime) / 1e6).toFixed(1)}s`);
console.log('\n== HOT SELF-TIME (leaves) ==');
for (const [k, v] of topLeaf) console.log(`  ${((100 * v) / totalSamples).toFixed(1).padStart(5)}%  ${k}`);
console.log('\n== SELF-TIME BY MODULE ==');
for (const [k, v] of topUrl) console.log(`  ${((100 * v) / totalSamples).toFixed(1).padStart(5)}%  ${k}`);

// ---- speedscope JSON ----
const frameList = [];
const frameIdx = new Map();
const key2info = new Map();
(function collect(n) {
  if (n.name !== 'root' && !frameIdx.has(n.name)) {
    const [nm, rest] = n.name.includes(' ') ? [n.name.slice(0, n.name.lastIndexOf(' ')), n.name.slice(n.name.lastIndexOf(' ') + 1)] : [n.name, ''];
    const li = rest.lastIndexOf(':');
    const file = li > -1 ? rest.slice(0, li) : rest;
    const line = li > -1 ? Number(rest.slice(li + 1)) - 1 : 0;
    frameIdx.set(n.name, frameList.length);
    frameList.push({ name: nm, file, lineNumber: Math.max(0, line), line: Math.max(0, line) });
    key2info.set(n.name, { name: nm, file });
  }
  for (const k of n.children.values()) collect(k);
})(root);

const events = [];
let prev = [];
let t = 0;
for (let i = 0; i < p.samples.length; i++) {
  t += (p.timeDeltas[i] || 0);
  const cur = stackOf(p.samples[i]);
  let c = 0;
  while (c < prev.length && c < cur.length && prev[c] === cur[c]) c++;
  for (let j = prev.length - 1; j >= c; j--) events.push({ type: 'C', at: t, frame: frameIdx.get(prev[j]) });
  for (let j = c; j < cur.length; j++) events.push({ type: 'O', at: t, frame: frameIdx.get(cur[j]) });
  prev = cur;
}
for (let j = prev.length - 1; j >= 0; j--) events.push({ type: 'C', at: t, frame: frameIdx.get(prev[j]) });

const speedscope = {
  version: '0.0.1', name: file, activeProfileIndex: 0, exporter: 'opencode-convert',
  shared: { frames: frameList.map((f) => ({ name: f.name, file: f.file, lineNumber: f.line })) },
  profiles: [{ type: 'evented', name: 'cpu-profile', unit: 'microseconds', startValue: 0, endValue: t, events }],
};
writeFileSync(join(dir, 'speedscope.json'), JSON.stringify(speedscope));

// ---- SVG flame graph ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const W = 1600, ROW = 17;
function hue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
const rects = [];
let maxDepth = 0;
(function draw(n, x0, w, depth) {
  maxDepth = Math.max(maxDepth, depth);
  if (n.name !== 'root' && w > 0.4) {
    const label = key2info.get(n.name) ? `${key2info.get(n.name).name}` : n.name;
    const pct = (100 * n.count) / root.count;
    rects.push(`<rect x="${x0.toFixed(1)}" y="${depth * ROW}" width="${Math.max(0.5, w - 0.5).toFixed(1)}" height="${ROW - 1}" fill="hsl(${hue(n.name)},62%,${Math.max(32, 74 - depth * 3)}%)" stroke="#fff" stroke-width="0.4"><title>${esc(n.name)} — ${pct.toFixed(2)}%</title></rect>`);
    if (w > 46) rects.push(`<text x="${(x0 + 3).toFixed(1)}" y="${depth * ROW + ROW - 4}" font-size="10" font-family="Segoe UI,monospace" fill="#101010">${esc(label.slice(0, Math.floor(w / 6.2)))}</text>`);
  }
  let x = x0;
  const kids = [...n.children.values()].sort((a, b) => b.count - a.count);
  for (const k of kids) { const kw = (w * k.count) / n.count; draw(k, x, kw, n.name === 'root' ? depth : depth + 1); x += kw; }
})(root, 0, W, 0);

const H = (maxDepth + 1) * ROW + 40;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<style>text{user-select:none}</style>
<rect width="${W}" height="${H}" fill="#fafafa"/>
<text x="12" y="18" font-size="13" font-family="Segoe UI" fill="#333">MediLink server CPU flame graph — ${totalSamples} samples, ${((p.endTime - p.startTime) / 1e6).toFixed(1)}s (hover a frame for name + %)</text>
<g transform="translate(0,30)">${rects.join('\n')}</g></svg>`;
writeFileSync(join(dir, 'flame.svg'), svg);

console.log(`\nwrote: flame.folded, speedscope.json (${frameList.length} frames, ${events.length} events), flame.svg (${H}px tall)`);

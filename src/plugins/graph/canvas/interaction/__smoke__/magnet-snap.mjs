// magnet-snap 几何计算 smoke
// 不依赖 Three.js / Scene,纯 JS 复算 listMagnets / resolveMagnet / findClosestMagnet
// 的语义,验证算法正确

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHAPES = join(__dirname, '../../../library/shapes/definitions');
const SUBS = join(__dirname, '../../../library/substances/definitions');

// 加载所有 shape / substance
const shapes = new Map();
for (const cat of readdirSync(SHAPES, { withFileTypes: true })) {
  if (!cat.isDirectory()) continue;
  for (const f of readdirSync(join(SHAPES, cat.name))) {
    if (!f.endsWith('.json')) continue;
    const def = JSON.parse(readFileSync(join(SHAPES, cat.name, f), 'utf-8'));
    shapes.set(def.id, def);
  }
}
const subs = new Map();
for (const cat of readdirSync(SUBS, { withFileTypes: true })) {
  if (!cat.isDirectory()) continue;
  for (const f of readdirSync(join(SUBS, cat.name))) {
    if (!f.endsWith('.json')) continue;
    const def = JSON.parse(readFileSync(join(SUBS, cat.name, f), 'utf-8'));
    subs.set(def.id, def);
  }
}

// 复实现 magnetsForInstance
function magnetsFor(inst) {
  if (inst.type === 'shape') return shapes.get(inst.ref)?.magnets ?? null;
  const def = subs.get(inst.ref);
  if (!def) return null;
  const frame = def.components.find(c => c.type === 'shape' && c.binding === 'frame')
             ?? def.components.find(c => c.type === 'shape');
  if (!frame) return null;
  return shapes.get(frame.ref)?.magnets ?? null;
}

// listMagnets:输入 (instance, position, size),输出世界坐标 magnet 列表
function listMagnets(inst, position, size) {
  const ms = magnetsFor(inst);
  if (!ms) return [];
  return ms.map(m => ({
    instanceId: inst.id,
    magnetId: m.id,
    x: position.x + m.x * size.w,
    y: position.y + m.y * size.h,
  }));
}

const failed = [];

// 测试 1:roundRect 在 (100,80) 200x100 → N magnet 应在 (200,80)
{
  const inst = { id: 't1', type: 'shape', ref: 'krig.basic.roundRect' };
  const ms = listMagnets(inst, { x: 100, y: 80 }, { w: 200, h: 100 });
  const N = ms.find(m => m.magnetId === 'N');
  const E = ms.find(m => m.magnetId === 'E');
  const S = ms.find(m => m.magnetId === 'S');
  const W = ms.find(m => m.magnetId === 'W');
  if (!N || N.x !== 200 || N.y !== 80) failed.push(`roundRect N expected (200,80) got ${JSON.stringify(N)}`);
  if (!E || E.x !== 300 || E.y !== 130) failed.push(`roundRect E expected (300,130) got ${JSON.stringify(E)}`);
  if (!S || S.x !== 200 || S.y !== 180) failed.push(`roundRect S expected (200,180) got ${JSON.stringify(S)}`);
  if (!W || W.x !== 100 || W.y !== 130) failed.push(`roundRect W expected (100,130) got ${JSON.stringify(W)}`);
}

// 测试 2:family.person substance 在 (50,220) → frame magnets(roundRect)正确
{
  const inst = { id: 't2', type: 'substance', ref: 'library.family.person' };
  // family.person 没显式 size,frame component 的 transform 是 160x60(从 JSON 看)
  const ms = listMagnets(inst, { x: 50, y: 220 }, { w: 160, h: 60 });
  const E = ms.find(m => m.magnetId === 'E');
  if (!E || E.x !== 50 + 160 || E.y !== 220 + 30) {
    failed.push(`family.person E expected (210,250) got ${JSON.stringify(E)}`);
  }
  if (ms.length !== 4) failed.push(`family.person should have 4 magnets, got ${ms.length}`);
}

// 测试 3:line(elbow)有 START / END magnet
{
  const inst = { id: 't3', type: 'shape', ref: 'krig.line.elbow' };
  const ms = listMagnets(inst, { x: 0, y: 0 }, { w: 100, h: 100 });
  const start = ms.find(m => m.magnetId === 'START');
  const end = ms.find(m => m.magnetId === 'END');
  if (!start) failed.push('elbow missing START magnet');
  if (!end) failed.push('elbow missing END magnet');
}

// 测试 4:findClosestMagnet 行为
function findClosest(worldX, worldY, candidates, max, exclude) {
  let best = null;
  for (const { inst, position, size } of candidates) {
    if (exclude?.has(inst.id)) continue;
    for (const m of listMagnets(inst, position, size)) {
      const d = Math.hypot(m.x - worldX, m.y - worldY);
      if (d > max) continue;
      if (!best || d < best.distance) best = { magnet: m, distance: d };
    }
  }
  return best;
}
{
  const cands = [
    { inst: { id: 'a', type: 'shape', ref: 'krig.basic.roundRect' }, position: { x: 0, y: 0 }, size: { w: 100, h: 100 } },
    { inst: { id: 'b', type: 'shape', ref: 'krig.basic.roundRect' }, position: { x: 200, y: 0 }, size: { w: 100, h: 100 } },
  ];
  // 鼠标在 (105, 50),最近的应是 a 的 E magnet (100, 50),距离 5
  const r = findClosest(105, 50, cands, 16);
  if (!r) failed.push('findClosest should find a magnet within radius');
  if (r && (r.magnet.instanceId !== 'a' || r.magnet.magnetId !== 'E')) {
    failed.push(`findClosest expected a.E got ${r.magnet.instanceId}.${r.magnet.magnetId}`);
  }
  // 排除 a → 应找 b 的 W magnet (200, 50),距离 95(超出 16),返回 null
  const r2 = findClosest(105, 50, cands, 16, new Set(['a']));
  if (r2) failed.push(`findClosest with exclude=a should miss, got ${JSON.stringify(r2)}`);
  // 增大半径 → 找到 b.W
  const r3 = findClosest(105, 50, cands, 200, new Set(['a']));
  if (!r3 || r3.magnet.instanceId !== 'b' || r3.magnet.magnetId !== 'W') {
    failed.push(`findClosest with large radius excluding a should find b.W`);
  }
}

// 测试 5:line endpoints 解析 — 检查 LineRenderer 能从 magnet 找到正确世界坐标
{
  // dev-1 roundRect at (50,50) 200x100
  // dev-3 ellipse at (500,50) 100x100
  // line elbow connecting dev-1.E → dev-3.W
  const dev1 = { inst: { id: 'dev-1', type: 'shape', ref: 'krig.basic.roundRect' }, position: { x: 50, y: 50 }, size: { w: 200, h: 100 } };
  const dev3 = { inst: { id: 'dev-3', type: 'shape', ref: 'krig.basic.ellipse' }, position: { x: 500, y: 50 }, size: { w: 100, h: 100 } };
  const dev1Magnets = listMagnets(dev1.inst, dev1.position, dev1.size);
  const dev3Magnets = listMagnets(dev3.inst, dev3.position, dev3.size);
  const startMagnet = dev1Magnets.find(m => m.magnetId === 'E');
  const endMagnet = dev3Magnets.find(m => m.magnetId === 'W');
  // E of (50+200, 50+50) = (250, 100)
  // W of (500+0, 50+50) = (500, 100)
  if (!startMagnet || startMagnet.x !== 250 || startMagnet.y !== 100) {
    failed.push(`dev-1.E expected (250,100), got ${JSON.stringify(startMagnet)}`);
  }
  if (!endMagnet || endMagnet.x !== 500 || endMagnet.y !== 100) {
    failed.push(`dev-3.W expected (500,100), got ${JSON.stringify(endMagnet)}`);
  }
}

console.log(`[magnet-smoke] ran 5 test groups`);
if (failed.length === 0) {
  console.log('[magnet-smoke] OK ✓');
  process.exit(0);
} else {
  console.error('[magnet-smoke] FAIL:');
  for (const f of failed) console.error('  ' + f);
  process.exit(1);
}

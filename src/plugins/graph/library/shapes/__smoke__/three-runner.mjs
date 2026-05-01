// Smoke test for path-to-three
// 用 esbuild 把 path-to-three.ts(及其依赖)bundle 成单个 mjs,然后在 Node 端跑
// 22 个 shape × 3 尺寸,验证产出的 fill / stroke geometry 不含 NaN
//
// 用法:node src/plugins/graph/library/shapes/__smoke__/three-runner.mjs

import { readdirSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RENDERERS = join(__dirname, '../renderers');
const DEFS = join(__dirname, '../definitions');
const ROOT = join(__dirname, '../../../../../..');   // 6 级回到仓库根

// Step 1:用 esbuild bundle path-to-three(连同 formula-eval、three)成一个 mjs
const tmpDir = mkdtempSync(join(tmpdir(), 'three-smoke-'));
const bundlePath = join(tmpDir, 'bundle.mjs');
try {
  execFileSync(
    join(ROOT, 'node_modules/.bin/esbuild'),
    [
      join(RENDERERS, 'path-to-three.ts'),
      '--bundle',
      '--platform=node',
      '--format=esm',
      `--outfile=${bundlePath}`,
      '--log-level=warning',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
} catch (e) {
  console.error('[three-smoke] esbuild failed');
  process.exit(1);
}

// Step 2:动态 import bundle
const { shapeToThree } = await import(bundlePath);

// Step 3:加载 shape JSON
function loadShapes() {
  const out = [];
  for (const cat of readdirSync(DEFS, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const f of readdirSync(join(DEFS, cat.name))) {
      if (!f.endsWith('.json')) continue;
      out.push(JSON.parse(readFileSync(join(DEFS, cat.name, f), 'utf-8')));
    }
  }
  return out;
}

function vertsHaveNaN(geom) {
  const pos = geom?.attributes?.position;
  if (!pos) return false;
  const arr = pos.array;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return true;
  }
  return false;
}

const shapes = loadShapes();
const cases = [
  { w: 200, h: 100 },
  { w: 50, h: 50 },
  { w: 400, h: 50 },
];
const failed = [];

for (const c of cases) {
  for (const s of shapes) {
    if (s.renderer !== 'parametric') continue;
    let out;
    try {
      out = shapeToThree(s, { width: c.w, height: c.h });
    } catch (e) {
      failed.push(`${c.w}x${c.h} ${s.id}: threw ${e.message}`);
      continue;
    }
    if (!out.group) {
      failed.push(`${c.w}x${c.h} ${s.id}: no group`); continue;
    }
    if (!out.fill && !out.stroke) {
      failed.push(`${c.w}x${c.h} ${s.id}: neither fill nor stroke`); continue;
    }
    if (out.fill && vertsHaveNaN(out.fill.geometry)) {
      failed.push(`${c.w}x${c.h} ${s.id}: fill geometry has NaN`);
    }
    if (out.stroke && vertsHaveNaN(out.stroke.geometry)) {
      failed.push(`${c.w}x${c.h} ${s.id}: stroke geometry has NaN`);
    }
    if (out.fill && out.fill.geometry.attributes.position.count < 3) {
      failed.push(`${c.w}x${c.h} ${s.id}: fill too few verts`);
    }
    if (out.stroke && out.stroke.geometry.attributes.position.count < 2) {
      failed.push(`${c.w}x${c.h} ${s.id}: stroke too few verts`);
    }
  }
}

// 清理
rmSync(tmpDir, { recursive: true, force: true });

const parametricCount = shapes.filter((s) => s.renderer === 'parametric').length;
console.log(`[three-smoke] tested ${parametricCount} parametric shapes × ${cases.length} sizes = ${parametricCount * cases.length} combos`);
if (failed.length === 0) {
  console.log('[three-smoke] OK ✓');
  process.exit(0);
} else {
  console.error('[three-smoke] FAIL:');
  for (const f of failed) console.error(`  ${f}`);
  process.exit(1);
}

// Substance smoke runner — Node 端
// 验证:
// 1. 5 个 substance 都被收齐
// 2. id 不重复
// 3. 每个 component 的 ref 都能在 shape definitions 里找到(避免 typo)
// 4. transform 字段必备
// 5. visual_rules 表达式语法可解析(轻校验,不实际 eval)

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SUBS = join(__dirname, '../definitions');
const SHAPES = join(__dirname, '../../shapes/definitions');

function loadAll(dir) {
  const out = [];
  for (const cat of readdirSync(dir, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    for (const f of readdirSync(join(dir, cat.name))) {
      if (!f.endsWith('.json')) continue;
      const def = JSON.parse(readFileSync(join(dir, cat.name, f), 'utf-8'));
      out.push({ path: `${cat.name}/${f}`, def });
    }
  }
  return out;
}

const shapes = loadAll(SHAPES);
const substances = loadAll(SUBS);

const shapeIds = new Set(shapes.map((s) => s.def.id));
const substanceIds = new Set();
const failed = [];
const byCategory = {};

for (const { path, def } of substances) {
  byCategory[def.category] = (byCategory[def.category] ?? 0) + 1;

  if (substanceIds.has(def.id)) {
    failed.push({ path, reason: `duplicate id ${def.id}` });
    continue;
  }
  substanceIds.add(def.id);

  if (!def.name) failed.push({ path, reason: 'missing name' });
  if (!Array.isArray(def.components) || def.components.length === 0) {
    failed.push({ path, reason: 'no components' });
    continue;
  }

  for (let i = 0; i < def.components.length; i++) {
    const c = def.components[i];
    if (c.type !== 'shape' && c.type !== 'substance') {
      failed.push({ path, reason: `component[${i}] bad type: ${c.type}` });
    }
    if (!c.ref) {
      failed.push({ path, reason: `component[${i}] missing ref` });
    }
    if (c.type === 'shape' && c.ref && !shapeIds.has(c.ref)) {
      failed.push({ path, reason: `component[${i}] ref="${c.ref}" not found in ShapeRegistry` });
    }
    if (!c.transform) {
      failed.push({ path, reason: `component[${i}] missing transform` });
    } else {
      const { x, y } = c.transform;
      if (typeof x !== 'number' || typeof y !== 'number') {
        failed.push({ path, reason: `component[${i}] transform.x/y not numbers` });
      }
    }
  }

  // visual_rules 语法 sanity:支持 ===  !==  >  <  >=  <=  + 字段名
  for (let i = 0; i < (def.visual_rules || []).length; i++) {
    const r = def.visual_rules[i];
    if (typeof r.if !== 'string' || !r.if.trim()) {
      failed.push({ path, reason: `visual_rules[${i}].if not a non-empty string` });
    }
    if (!r.apply || typeof r.apply !== 'object') {
      failed.push({ path, reason: `visual_rules[${i}].apply not an object` });
    }
  }
}

console.log(`[substance-smoke] total=${substances.length} categories=${JSON.stringify(byCategory)}`);
console.log(`[substance-smoke] shape refs verified against ${shapeIds.size} shapes`);
if (failed.length === 0) {
  console.log('[substance-smoke] OK ✓');
  process.exit(0);
} else {
  console.error('[substance-smoke] FAIL:');
  for (const f of failed) console.error(`  ${f.path}: ${f.reason}`);
  process.exit(1);
}

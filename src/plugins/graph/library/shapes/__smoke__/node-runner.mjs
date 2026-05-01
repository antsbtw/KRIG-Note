// Node-side smoke runner for parametric renderer
// 直接读 22 个 JSON 文件,喂给 renderer,验证产物
// 用法:node src/plugins/graph/library/shapes/__smoke__/node-runner.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

// 让 Node 能 require .ts(用 ts-blank-space 替代 tsc 的开销)
// 但更简单的方法:动态 import 直接走 .ts → 不行,Node 默认不识别
// 退而求其次:把 formula-eval / parametric 内联编译进这里(纯 TS 类型擦除即可,
// 因为没有装饰器或 enum 等 runtime 特殊语法)
// 但更稳妥:让它走 node 的 stripping(node 22.6+ --experimental-strip-types)

// 改方案:这个脚本只检查 JSON 结构 + 用一个**简化的 Node 端 evaluator**
// 跑一遍 path,验证不产生 NaN。renderer 本身的逻辑会在浏览器跑时再被覆盖。

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFS = join(__dirname, '../definitions');

// 17 操作符的简化重实现(与 formula-eval.ts 同语义)
const DEG = Math.PI / 180;
function evalOp(op, args) {
  switch (op) {
    case '*/':  return (args[0] * args[1]) / args[2];
    case '+-':  return (args[0] + args[1]) - args[2];
    case '+/':  return (args[0] + args[1]) / args[2];
    case 'abs': return Math.abs(args[0]);
    case 'sqrt':return Math.sqrt(args[0]);
    case 'mod': return Math.sqrt(args[0]**2 + args[1]**2 + args[2]**2);
    case 'pin': return Math.max(args[0], Math.min(args[1], args[2]));
    case 'max': return Math.max(args[0], args[1]);
    case 'min': return Math.min(args[0], args[1]);
    case 'val': return args[0];
    case 'sin': return args[0] * Math.sin(args[1] * DEG);
    case 'cos': return args[0] * Math.cos(args[1] * DEG);
    case 'tan': return args[0] * Math.tan(args[1] * DEG);
    case 'at2': return Math.atan2(args[1], args[0]) / DEG;
    case 'cat2':return args[0] * Math.cos(Math.atan2(args[2], args[1]));
    case 'sat2':return args[0] * Math.sin(Math.atan2(args[2], args[1]));
    case '?:':  return args[0] > 0 ? args[1] : args[2];
    default:    throw new Error(`unknown op: ${op}`);
  }
}

function builtinIdent(name, env) {
  const { w, h } = env;
  switch (name) {
    case 'w': return w;
    case 'h': return h;
    case 'ss': return Math.min(w, h);
    case 't': case 'l': return 0;
    case 'r': return w;
    case 'b': return h;
    case 'hc': return w / 2;
    case 'vc': return h / 2;
    case 'cd2': return 180;
    case 'cd4': return 90;
    case 'cd8': return 45;
  }
  const m = /^([wh])d(\d+)$/.exec(name);
  if (m) return (m[1] === 'w' ? w : h) / Number(m[2]);
  return undefined;
}

function resolveIdent(name, env) {
  const t = String(name).trim();
  if (t === '') throw new Error('empty ident');
  if (!Number.isNaN(Number(t))) return Number(t);
  const built = builtinIdent(t, env);
  if (built !== undefined) return built;
  const pm = /^params\.(\w+)$/.exec(t);
  if (pm) {
    if (!(pm[1] in env.params)) throw new Error(`unknown param: ${pm[1]}`);
    return env.params[pm[1]];
  }
  if (t in env.params) return env.params[t];
  if (t in env.guides) return env.guides[t];
  throw new Error(`unknown identifier: ${t}`);
}

function evalSimpleExpr(expr, env) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ' || ch === '\t') { i++; continue; }
    if (ch === '+' || ch === '-') { tokens.push({ kind: 'op', v: ch }); i++; continue; }
    let j = i;
    while (j < expr.length && expr[j] !== '+' && expr[j] !== '-' && expr[j] !== ' ' && expr[j] !== '\t') j++;
    tokens.push({ kind: 'num', v: expr.slice(i, j) });
    i = j;
  }
  if (tokens.length === 0 || tokens[0].kind !== 'num') throw new Error(`bad expr: ${expr}`);
  let acc = resolveIdent(tokens[0].v, env);
  for (let k = 1; k < tokens.length; k += 2) {
    const op = tokens[k]; const rhs = tokens[k+1];
    if (op.kind !== 'op' || rhs.kind !== 'num') throw new Error(`bad expr: ${expr}`);
    const v = resolveIdent(rhs.v, env);
    acc = op.v === '+' ? acc + v : acc - v;
  }
  return acc;
}

function evalString(s, env) {
  const t = s.trim();
  if (t.includes('+') || t.includes('-')) {
    const isNegLit = t[0] === '-' && !/[\+\-]/.test(t.slice(1));
    if (isNegLit) return Number(t);
    return evalSimpleExpr(t, env);
  }
  return resolveIdent(t, env);
}

function evalFormula(v, env) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return evalString(v, env);
  return evalOp(v.op, v.args.map((a) => evalFormula(a, env)));
}

function buildEnv(shape, w, h) {
  const params = {};
  for (const name in shape.params || {}) {
    const def = shape.params[name];
    let val = def.default;
    if (def.min !== undefined && val < def.min) val = def.min;
    if (def.max !== undefined && val > def.max) val = def.max;
    params[name] = val;
  }
  const guides = {};
  const env = { w, h, params, guides };
  for (const g of shape.guides || []) {
    guides[g.name] = evalOp(g.op, g.args.map((a) => evalFormula(a, env)));
  }
  return env;
}

function pathToD(path, env) {
  const parts = [];
  for (const cmd of path) {
    switch (cmd.cmd) {
      case 'M':
      case 'L':
        parts.push(`${cmd.cmd} ${evalFormula(cmd.x, env)} ${evalFormula(cmd.y, env)}`);
        break;
      case 'A':
        parts.push(`A ${evalFormula(cmd.rx, env)} ${evalFormula(cmd.ry, env)} 0 ${cmd['large-arc-flag']??0} ${cmd['sweep-flag']??1} ${evalFormula(cmd.x, env)} ${evalFormula(cmd.y, env)}`);
        break;
      case 'Q':
        parts.push(`Q ${evalFormula(cmd.x1, env)} ${evalFormula(cmd.y1, env)} ${evalFormula(cmd.x, env)} ${evalFormula(cmd.y, env)}`);
        break;
      case 'C':
        parts.push(`C ${evalFormula(cmd.x1, env)} ${evalFormula(cmd.y1, env)} ${evalFormula(cmd.x2, env)} ${evalFormula(cmd.y2, env)} ${evalFormula(cmd.x, env)} ${evalFormula(cmd.y, env)}`);
        break;
      case 'Z':
        parts.push('Z');
        break;
    }
  }
  return parts.join(' ');
}

// 收集 22 个 JSON
function collectShapes() {
  const shapes = [];
  for (const cat of readdirSync(DEFS, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    const dir = join(DEFS, cat.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const def = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      shapes.push({ path: `${cat.name}/${f}`, def });
    }
  }
  return shapes;
}

// 运行
const shapes = collectShapes();
const failed = [];
const byCategory = {};
const seen = new Set();

for (const { path, def } of shapes) {
  byCategory[def.category] = (byCategory[def.category] ?? 0) + 1;
  if (seen.has(def.id)) {
    failed.push({ path, reason: `duplicate id ${def.id}` });
    continue;
  }
  seen.add(def.id);

  if (def.renderer !== 'parametric') continue;
  if (!def.path) {
    failed.push({ path, reason: 'no path' });
    continue;
  }

  try {
    const env = buildEnv(def, 200, 100);
    const d = pathToD(def.path, env);
    if (!d) failed.push({ path, reason: 'empty d' });
    if (/NaN|Infinity|undefined/.test(d)) {
      failed.push({ path, reason: `bad d: ${d}` });
    }
    for (const m of def.magnets || []) {
      if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) {
        failed.push({ path, reason: `magnet ${m.id} not finite` });
      }
    }
    if (def.textBox) {
      const tb = {
        l: evalFormula(def.textBox.l, env),
        t: evalFormula(def.textBox.t, env),
        r: evalFormula(def.textBox.r, env),
        b: evalFormula(def.textBox.b, env),
      };
      for (const k of ['l','t','r','b']) {
        if (!Number.isFinite(tb[k])) failed.push({ path, reason: `textBox.${k} not finite` });
      }
    }
  } catch (e) {
    failed.push({ path, reason: `threw: ${e.message}` });
  }
}

console.log(`[shape-smoke] total=${shapes.length} categories=${JSON.stringify(byCategory)}`);
if (failed.length === 0) {
  console.log('[shape-smoke] OK ✓');
  process.exit(0);
} else {
  console.error('[shape-smoke] FAIL:');
  for (const f of failed) console.error(`  ${f.path}: ${f.reason}`);
  process.exit(1);
}

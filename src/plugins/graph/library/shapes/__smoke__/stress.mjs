// Stress test — 极端尺寸 / 极端 param 覆盖
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFS = join(__dirname, '../definitions');

// 复用 node-runner 的 evaluator(动态导入)
const runnerPath = join(__dirname, 'node-runner.mjs');
// 直接 source 复用太麻烦,简单复制核心函数:
const DEG = Math.PI / 180;
const ops = {
  '*/':  a=>(a[0]*a[1])/a[2], '+-':a=>(a[0]+a[1])-a[2], '+/':a=>(a[0]+a[1])/a[2],
  abs:a=>Math.abs(a[0]), sqrt:a=>Math.sqrt(a[0]),
  mod:a=>Math.sqrt(a[0]**2+a[1]**2+a[2]**2),
  pin:a=>Math.max(a[0],Math.min(a[1],a[2])),
  max:a=>Math.max(a[0],a[1]), min:a=>Math.min(a[0],a[1]),
  val:a=>a[0],
  sin:a=>a[0]*Math.sin(a[1]*DEG), cos:a=>a[0]*Math.cos(a[1]*DEG), tan:a=>a[0]*Math.tan(a[1]*DEG),
  at2:a=>Math.atan2(a[1],a[0])/DEG,
  cat2:a=>a[0]*Math.cos(Math.atan2(a[2],a[1])),
  sat2:a=>a[0]*Math.sin(Math.atan2(a[2],a[1])),
  '?:':a=>a[0]>0?a[1]:a[2],
};
function builtin(name, env) {
  const {w,h} = env;
  if (name==='w') return w; if (name==='h') return h;
  if (name==='ss') return Math.min(w,h);
  if (name==='t'||name==='l') return 0;
  if (name==='r') return w; if (name==='b') return h;
  if (name==='hc') return w/2; if (name==='vc') return h/2;
  if (name==='cd2') return 180; if (name==='cd4') return 90; if (name==='cd8') return 45;
  const m = /^([wh])d(\d+)$/.exec(name);
  if (m) return (m[1]==='w'?w:h)/Number(m[2]);
  return undefined;
}
function ident(name, env) {
  const t = String(name).trim();
  if (!Number.isNaN(Number(t))) return Number(t);
  const b = builtin(t, env); if (b!==undefined) return b;
  const pm = /^params\.(\w+)$/.exec(t);
  if (pm) return env.params[pm[1]];
  if (t in env.params) return env.params[t];
  if (t in env.guides) return env.guides[t];
  throw new Error(`unknown ident: ${t}`);
}
function evalExpr(s, env) {
  const t = s.trim();
  if (t.includes('+') || t.includes('-')) {
    if (t[0]==='-' && !/[\+\-]/.test(t.slice(1))) return Number(t);
    const tokens=[]; let i=0;
    while (i<t.length) {
      const c=t[i]; if (c===' '||c==='\t'){i++;continue;}
      if (c==='+'||c==='-'){tokens.push({op:c});i++;continue;}
      let j=i; while (j<t.length && t[j]!=='+'&&t[j]!=='-'&&t[j]!==' '&&t[j]!=='\t') j++;
      tokens.push({n:t.slice(i,j)}); i=j;
    }
    let acc=ident(tokens[0].n,env);
    for (let k=1;k<tokens.length;k+=2) {
      const v=ident(tokens[k+1].n,env);
      acc = tokens[k].op==='+'?acc+v:acc-v;
    }
    return acc;
  }
  return ident(t, env);
}
function evalF(v, env) {
  if (typeof v==='number') return v;
  if (typeof v==='string') return evalExpr(v, env);
  return ops[v.op](v.args.map(a=>evalF(a,env)));
}
function buildEnv(shape, w, h, overrides={}) {
  const params={};
  for (const n in shape.params||{}) {
    const d=shape.params[n];
    let v = overrides[n] !== undefined ? overrides[n] : d.default;
    if (d.min!==undefined && v<d.min) v=d.min;
    if (d.max!==undefined && v>d.max) v=d.max;
    params[n]=v;
  }
  const guides={}; const env={w,h,params,guides};
  for (const g of shape.guides||[]) {
    guides[g.name]=ops[g.op](g.args.map(a=>evalF(a,env)));
  }
  return env;
}
function pathD(path, env) {
  const out=[];
  for (const c of path) {
    if (c.cmd==='M'||c.cmd==='L') out.push(`${c.cmd} ${evalF(c.x,env)} ${evalF(c.y,env)}`);
    else if (c.cmd==='A') out.push(`A ${evalF(c.rx,env)} ${evalF(c.ry,env)} 0 ${c['large-arc-flag']??0} ${c['sweep-flag']??1} ${evalF(c.x,env)} ${evalF(c.y,env)}`);
    else if (c.cmd==='Q') out.push(`Q ${evalF(c.x1,env)} ${evalF(c.y1,env)} ${evalF(c.x,env)} ${evalF(c.y,env)}`);
    else if (c.cmd==='C') out.push(`C ${evalF(c.x1,env)} ${evalF(c.y1,env)} ${evalF(c.x2,env)} ${evalF(c.y2,env)} ${evalF(c.x,env)} ${evalF(c.y,env)}`);
    else if (c.cmd==='Z') out.push('Z');
  }
  return out.join(' ');
}

// 加载所有 shape
const shapes = [];
for (const cat of readdirSync(DEFS, { withFileTypes: true })) {
  if (!cat.isDirectory()) continue;
  for (const f of readdirSync(join(DEFS, cat.name))) {
    if (!f.endsWith('.json')) continue;
    shapes.push(JSON.parse(readFileSync(join(DEFS, cat.name, f), 'utf-8')));
  }
}

// 测试矩阵:多种尺寸
const cases = [
  { w: 200, h: 100, label: 'normal' },
  { w: 10,  h: 10,  label: 'tiny' },
  { w: 1000, h: 10, label: 'wide-thin' },
  { w: 10, h: 1000, label: 'tall-thin' },
  { w: 1, h: 1, label: 'pixel' },
];
let totalCheck = 0, fails = 0;
for (const c of cases) {
  for (const s of shapes) {
    if (s.renderer !== 'parametric' || !s.path) continue;
    totalCheck++;
    try {
      const env = buildEnv(s, c.w, c.h);
      const d = pathD(s.path, env);
      if (/NaN|Infinity|undefined/.test(d)) {
        console.error(`FAIL ${c.label} ${s.id}: ${d}`);
        fails++;
      }
    } catch (e) {
      console.error(`THREW ${c.label} ${s.id}: ${e.message}`);
      fails++;
    }
  }
}

// 测试 param 覆盖到边界
const overrideCases = [
  { id: 'krig.basic.roundRect', overrides: { r: 0 }, label: 'r=0' },
  { id: 'krig.basic.roundRect', overrides: { r: 0.5 }, label: 'r=0.5' },
  { id: 'krig.arrow.right', overrides: { headLen: 0.1 }, label: 'tinyHead' },
  { id: 'krig.arrow.right', overrides: { headLen: 0.5, headWidth: 1 }, label: 'maxHead' },
  { id: 'krig.basic.parallelogram', overrides: { adj: 0 }, label: 'noSlant' },
  { id: 'krig.basic.parallelogram', overrides: { adj: 0.5 }, label: 'maxSlant' },
];
for (const oc of overrideCases) {
  const s = shapes.find(x => x.id === oc.id);
  if (!s) continue;
  totalCheck++;
  try {
    const env = buildEnv(s, 200, 100, oc.overrides);
    const d = pathD(s.path, env);
    if (/NaN|Infinity|undefined/.test(d)) {
      console.error(`FAIL override ${oc.label} ${s.id}: ${d}`);
      fails++;
    }
  } catch (e) {
    console.error(`THREW override ${oc.label} ${s.id}: ${e.message}`);
    fails++;
  }
}

console.log(`[stress] checks=${totalCheck} fails=${fails}`);
process.exit(fails === 0 ? 0 : 1);

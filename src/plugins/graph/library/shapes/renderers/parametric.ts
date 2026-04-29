import type { PathCmd, RenderContext, RenderOutput, ShapeDef } from '../../types';
import { buildEnv, evalFormula, type EvalEnv } from './formula-eval';

/**
 * Parametric renderer — 把 ShapeDef.path 求值成标准 SVG path 字符串
 *
 * 输出 RenderOutput.kind = 'svg-path',data 形如:
 *   { d: "M 0 0 L 100 0 ...", magnets: [{id, x, y}], textBox: {l,t,r,b} }
 *
 * 路径数值用 4 位小数四舍五入(避免浮点漂移产生过长字符串)。
 *
 * M1.1d 的 path-to-three 会消费 d 字符串,转 THREE.Shape → Mesh。
 */
export interface ParametricOutput {
  d: string;                                      // SVG path d
  width: number;                                  // 实际尺寸(透传)
  height: number;
  magnets: Array<{ id: string; x: number; y: number }>;  // 已转世界坐标
  textBox?: { l: number; t: number; r: number; b: number };
}

export function renderParametric(
  shape: ShapeDef,
  ctx: RenderContext,
): RenderOutput {
  if (shape.renderer !== 'parametric') {
    throw new Error(`[parametric] expected renderer='parametric', got '${shape.renderer}' (${shape.id})`);
  }
  if (!shape.path) {
    throw new Error(`[parametric] shape '${shape.id}' has no path`);
  }

  const env = buildEnv(shape, ctx.width, ctx.height, ctx.params);
  const d = pathToSvg(shape.path, env);
  const magnets = (shape.magnets ?? []).map((m) => ({
    id: m.id,
    x: m.x * ctx.width,
    y: m.y * ctx.height,
  }));
  const textBox = shape.textBox
    ? {
        l: evalFormula(shape.textBox.l, env),
        t: evalFormula(shape.textBox.t, env),
        r: evalFormula(shape.textBox.r, env),
        b: evalFormula(shape.textBox.b, env),
      }
    : undefined;

  const out: ParametricOutput = {
    d,
    width: ctx.width,
    height: ctx.height,
    magnets,
    textBox,
  };
  return { kind: 'svg-path', data: out };
}

/** 把 PathCmd[] 串成 SVG d 字符串 */
function pathToSvg(path: PathCmd[], env: EvalEnv): string {
  const parts: string[] = [];
  for (const cmd of path) {
    switch (cmd.cmd) {
      case 'M':
      case 'L':
        parts.push(`${cmd.cmd} ${num(evalFormula(cmd.x, env))} ${num(evalFormula(cmd.y, env))}`);
        break;
      case 'A': {
        const rx = num(evalFormula(cmd.rx, env));
        const ry = num(evalFormula(cmd.ry, env));
        const x = num(evalFormula(cmd.x, env));
        const y = num(evalFormula(cmd.y, env));
        const large = cmd['large-arc-flag'] ?? 0;
        const sweep = cmd['sweep-flag'] ?? 1;
        // SVG arc:rx ry x-axis-rotation large-arc-flag sweep-flag x y
        parts.push(`A ${rx} ${ry} 0 ${large} ${sweep} ${x} ${y}`);
        break;
      }
      case 'Q':
        parts.push(
          `Q ${num(evalFormula(cmd.x1, env))} ${num(evalFormula(cmd.y1, env))} ` +
          `${num(evalFormula(cmd.x, env))} ${num(evalFormula(cmd.y, env))}`,
        );
        break;
      case 'C':
        parts.push(
          `C ${num(evalFormula(cmd.x1, env))} ${num(evalFormula(cmd.y1, env))} ` +
          `${num(evalFormula(cmd.x2, env))} ${num(evalFormula(cmd.y2, env))} ` +
          `${num(evalFormula(cmd.x, env))} ${num(evalFormula(cmd.y, env))}`,
        );
        break;
      case 'Z':
        parts.push('Z');
        break;
    }
  }
  return parts.join(' ');
}

/** 4 位小数 */
function num(v: number): number {
  return Math.round(v * 10000) / 10000;
}

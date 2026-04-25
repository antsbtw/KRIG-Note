/**
 * mathInline → SVG path 序列化
 *
 * F2 路径草稿：用 KaTeX 渲染到 hidden DOM，提取 SVG 输出，path 化处理。
 *
 * PoC Day 1-2 待实现：
 * - 实测 KaTeX renderToString 输出（HTML 还是 SVG？）
 * - 若是 HTML → 走 F3 文字纹理或 F1 字体路径
 * - 若是 SVG → 直接复用 + outline 化文字部分
 *
 * 当前先给 stub，让端到端管线可跑通。
 */
export async function renderMathInline(
  _tex: string,
  fontSize: number,
  x: number,
  baselineY: number,
): Promise<{ svg: string; advance: number }> {
  const w = 60;
  const h = fontSize + 4;
  const top = baselineY - fontSize - 2;
  const svg = `<path d="M ${x} ${top} h ${w} v ${h} h -${w} Z" fill="#88aaff" opacity="0.5" />`;
  return { svg, advance: w + 4 };
}

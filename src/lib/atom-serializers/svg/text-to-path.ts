/**
 * F1 路径：opentype.js + 字体子集 → 文字 outline 化
 *
 * PoC Day 1 实现重点：
 * 1. 加载一种西文字体（Inter / Roboto），通过 opentype.parse(buffer)
 * 2. font.getPath(text, x, y, fontSize).toPathData() → 返回 d="..."
 * 3. 包成 <path> 元素，颜色用样式 fill
 *
 * 当前是 stub —— 返回空，textBlock 会走 fallbackPlaceholder。
 * Day 1 把这里换成真实 opentype.js 实现。
 */
export async function textToPath(
  _text: string,
  _fontSize: number,
  _x: number,
  _baselineY: number,
): Promise<{ svg: string; advance: number }> {
  return { svg: '', advance: 0 };
}

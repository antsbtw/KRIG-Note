import { loadFont, pickFontForChar } from './font-loader';
import type { FontKey } from './fonts';

/**
 * F1 路径：opentype.js 把文字 outline 化为 SVG path
 *
 * 字符级混排策略：
 * - 文本按字符切分
 * - 每字符按是否 CJK 选择字体（Inter / Noto SC）
 * - 同字体连续字符合并一次 getPath 调用，减小 path 数量
 * - 输出多个 <path d="..." fill="..." />，水平串联
 *
 * 返回的 svg 不含 fill 颜色 → 由调用方决定（默认 #ddd 浅灰，适合深色背景）
 */
export async function textToPath(
  text: string,
  fontSize: number,
  startX: number,
  baselineY: number,
  fill = '#dddddd',
): Promise<{ svg: string; advance: number }> {
  if (!text) return { svg: '', advance: 0 };

  const segments = splitByFont(text);
  const parts: string[] = [];
  let x = startX;

  for (const seg of segments) {
    const font = await loadFont(seg.fontKey);
    const path = font.getPath(seg.text, x, baselineY, fontSize);
    const d = path.toPathData(2);
    if (d) {
      parts.push(`<path d="${d}" fill="${fill}" />`);
    }
    const advance = font.getAdvanceWidth(seg.text, fontSize);
    x += advance;
  }

  return { svg: parts.join(''), advance: x - startX };
}

interface FontSegment {
  text: string;
  fontKey: FontKey;
}

function splitByFont(text: string): FontSegment[] {
  const out: FontSegment[] = [];
  let current: FontSegment | null = null;

  for (const ch of text) {
    const fontKey = pickFontForChar(ch);
    if (current && current.fontKey === fontKey) {
      current.text += ch;
    } else {
      if (current) out.push(current);
      current = { text: ch, fontKey };
    }
  }
  if (current) out.push(current);
  return out;
}

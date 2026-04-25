import type { Atom } from '../../types';
import { textToPath } from '../text-to-path';
import { renderMathInline } from './mathInline';

const BASE_FONT_SIZE = 14;
const BASE_LINE_HEIGHT = 20;
const CHAR_ADVANCE_FALLBACK = 8;

/**
 * Note 系统中 heading 是 textBlock 上的 level attr：
 * - null / undefined → paragraph
 * - 1 → h1
 * - 2 → h2
 * - 3 → h3
 *
 * 序列化器读 attrs.level 决定字号 / 行高，不需要单独的 heading atom 类型。
 */
function getHeadingScale(level: unknown): number {
  switch (level) {
    case 1: return 1.6;
    case 2: return 1.35;
    case 3: return 1.15;
    default: return 1;
  }
}

export async function renderTextBlock(
  atom: Atom,
  yOffset: number,
): Promise<{ svg: string; height: number }> {
  const scale = getHeadingScale(atom.attrs?.level);
  const fontSize = BASE_FONT_SIZE * scale;
  const lineHeight = BASE_LINE_HEIGHT * scale;

  if (!atom.content || atom.content.length === 0) {
    return { svg: '', height: lineHeight };
  }

  const parts: string[] = [];
  let x = 4;
  const baselineY = yOffset + fontSize + 2;

  for (const inline of atom.content) {
    if (inline.type === 'text' && inline.text) {
      const { svg, advance } = await textToPath(inline.text, fontSize, x, baselineY);
      if (svg) {
        parts.push(svg);
        x += advance;
      } else {
        parts.push(fallbackPlaceholder(inline.text, x, baselineY, fontSize));
        x += inline.text.length * CHAR_ADVANCE_FALLBACK * scale;
      }
    } else if (inline.type === 'mathInline') {
      const tex = (inline.attrs?.tex as string) ?? '';
      const { svg, advance } = await renderMathInline(tex, fontSize, x, baselineY);
      if (svg) {
        parts.push(svg);
        x += advance;
      } else {
        parts.push(fallbackPlaceholder(`[math: ${tex}]`, x, baselineY, fontSize));
        x += tex.length * CHAR_ADVANCE_FALLBACK * scale + 8;
      }
    }
  }

  return { svg: parts.join(''), height: lineHeight };
}

/** 字体方案不可用时的占位 path —— 画一个小矩形让 SVGLoader 能解析出几何 */
function fallbackPlaceholder(text: string, x: number, baselineY: number, fontSize: number): string {
  const w = Math.max(text.length * 6, 10);
  const h = fontSize - 2;
  const top = baselineY - fontSize;
  return `<path d="M ${x} ${top} h ${w} v ${h} h -${w} Z" fill="#cccccc" />`;
}

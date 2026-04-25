import type { Atom } from '../../../../plugins/graph/poc/types';
import { textToPath } from '../text-to-path';
import { renderMathInline } from './mathInline';

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const CHAR_ADVANCE_FALLBACK = 8;

export async function renderTextBlock(
  atom: Atom,
  yOffset: number,
): Promise<{ svg: string; height: number }> {
  if (!atom.content || atom.content.length === 0) {
    return { svg: '', height: LINE_HEIGHT };
  }

  const parts: string[] = [];
  let x = 4;
  const baselineY = yOffset + FONT_SIZE + 2;

  for (const inline of atom.content) {
    if (inline.type === 'text' && inline.text) {
      const { svg, advance } = await textToPath(inline.text, FONT_SIZE, x, baselineY);
      if (svg) {
        parts.push(svg);
        x += advance;
      } else {
        parts.push(fallbackPlaceholder(inline.text, x, baselineY));
        x += inline.text.length * CHAR_ADVANCE_FALLBACK;
      }
    } else if (inline.type === 'mathInline') {
      const tex = (inline.attrs?.tex as string) ?? '';
      const { svg, advance } = await renderMathInline(tex, FONT_SIZE, x, baselineY);
      if (svg) {
        parts.push(svg);
        x += advance;
      } else {
        parts.push(fallbackPlaceholder(`[math: ${tex}]`, x, baselineY));
        x += tex.length * CHAR_ADVANCE_FALLBACK + 8;
      }
    }
  }

  return { svg: parts.join(''), height: LINE_HEIGHT };
}

/** 字体方案不可用时的占位 path —— 画一个小矩形让 SVGLoader 能解析出几何 */
function fallbackPlaceholder(text: string, x: number, baselineY: number): string {
  const w = Math.max(text.length * 6, 10);
  const h = FONT_SIZE - 2;
  const top = baselineY - FONT_SIZE;
  return `<path d="M ${x} ${top} h ${w} v ${h} h -${w} Z" fill="#cccccc" />`;
}

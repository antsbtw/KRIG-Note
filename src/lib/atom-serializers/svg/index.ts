import type { Atom } from '../types';
export type { Atom } from '../types';
import { renderTextBlock } from './blocks/textBlock';
import { renderMathBlock } from './blocks/mathBlock';
import { LruCache } from '../lru';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWBOX_W = 200;
const VIEWBOX_H = 30;
const FONT_SIZE = 14;

/** L1 SvgCache（spec § 5.1）：atoms hash → SVG 字符串 */
const SVG_CACHE = new LruCache<string, string>(1000);

/** 暴露给上层用于性能监控 / 调试 */
export function getSvgCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
  return {
    size: SVG_CACHE.size,
    hits: SVG_CACHE.hits,
    misses: SVG_CACHE.misses,
    hitRate: SVG_CACHE.hitRate(),
  };
}

export function clearSvgCache(): void {
  SVG_CACHE.clear();
}

export async function atomsToSvg(atoms: Atom[]): Promise<string> {
  const key = JSON.stringify(atoms);
  const cached = SVG_CACHE.get(key);
  if (cached !== undefined) return cached;

  const parts: string[] = [];
  let y = 0;
  for (const atom of atoms) {
    const { svg, height } = await renderAtom(atom, y);
    if (svg) parts.push(svg);
    y += height;
  }
  const result = wrapSvg(parts.join('\n'), VIEWBOX_W, Math.max(VIEWBOX_H, y));
  SVG_CACHE.set(key, result);
  return result;
}

async function renderAtom(atom: Atom, yOffset: number): Promise<{ svg: string; height: number }> {
  switch (atom.type) {
    case 'textBlock':
      return renderTextBlock(atom, yOffset);
    case 'mathBlock': {
      const tex = (atom.attrs?.tex as string) ?? '';
      return renderMathBlock(tex, FONT_SIZE, yOffset);
    }
    default:
      return { svg: '', height: 0 };
  }
}

function wrapSvg(inner: string, w: number, h: number): string {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`;
}

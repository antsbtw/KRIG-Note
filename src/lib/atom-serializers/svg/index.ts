import type { Atom } from '../../../plugins/graph/poc/types';
import { renderTextBlock } from './blocks/textBlock';
import { renderMathBlock } from './blocks/mathBlock';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEWBOX_W = 200;
const VIEWBOX_H = 30;
const FONT_SIZE = 14;

export async function atomsToSvg(atoms: Atom[]): Promise<string> {
  const parts: string[] = [];
  let y = 0;
  for (const atom of atoms) {
    const { svg, height } = await renderAtom(atom, y);
    if (svg) parts.push(svg);
    y += height;
  }
  return wrapSvg(parts.join('\n'), VIEWBOX_W, Math.max(VIEWBOX_H, y));
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

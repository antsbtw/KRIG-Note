import type { Atom } from '../types';
export type { Atom } from '../types';
import { renderTextBlock } from './blocks/textBlock';
import { renderMathBlock } from './blocks/mathBlock';
import { renderList } from './blocks/list';
import { LruCache } from '../lru';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_VIEWBOX_W = 200;
const VIEWBOX_H = 30;
const FONT_SIZE = 14;
/** 内容区左右各留白(textBlock x 起点 4 + 右边 4),对齐 textBlock 内 x = 4 起算 */
const HORIZONTAL_PADDING = 8;

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

export interface AtomsToSvgOptions {
  /** 整个 SVG 的目标宽度(画板的 instance.size.w);不指定时用 DEFAULT_VIEWBOX_W */
  width?: number;
}

export async function atomsToSvg(
  atoms: Atom[],
  options: AtomsToSvgOptions = {},
): Promise<string> {
  const viewBoxW = options.width ?? DEFAULT_VIEWBOX_W;
  // 缓存 key 含 width(同 atoms 不同 width wrap 结果不同)
  const key = `w=${viewBoxW}|${JSON.stringify(atoms)}`;
  const cached = SVG_CACHE.get(key);
  if (cached !== undefined) return cached;

  // 内容区有效宽度(留出左右 padding,与 textBlock x 起点 4 一致)
  const contentWidth = Math.max(20, viewBoxW - HORIZONTAL_PADDING);

  const parts: string[] = [];
  let y = 0;
  for (const atom of atoms) {
    const { svg, height } = await renderAtom(atom, y, contentWidth);
    if (svg) parts.push(svg);
    y += height;
  }
  const result = wrapSvg(parts.join('\n'), viewBoxW, Math.max(VIEWBOX_H, y));
  SVG_CACHE.set(key, result);
  return result;
}

async function renderAtom(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
): Promise<{ svg: string; height: number }> {
  switch (atom.type) {
    case 'textBlock':
      return renderTextBlock(atom, yOffset, contentWidth);
    case 'mathBlock': {
      // NoteView mathBlock schema:content: 'text*',LaTeX 存在 PM 子 text 节点里
      // 兼容老 attrs.latex / attrs.tex 数据(若 content 为空)
      const fromContent = extractMathLatex(atom);
      const latex = fromContent
        || (atom.attrs?.latex as string)
        || (atom.attrs?.tex as string)
        || '';
      return renderMathBlock(latex, FONT_SIZE, yOffset);
    }
    case 'bulletList':
      return renderList(atom, yOffset, false, 0, contentWidth);
    case 'orderedList':
      return renderList(atom, yOffset, true, 0, contentWidth);
    default:
      // 未识别的 block:渲染一行灰字占位
      return renderUnknownAtom(atom, yOffset, contentWidth);
  }
}

/**
 * 从 PM JSON 形态的 mathBlock 抽 LaTeX 字符串.
 *
 * NoteView mathBlock schema 是 `content: 'text*'`,LaTeX 当作普通文本子节点存,
 * PM JSON: { content: [{ type: 'text', text: 'x^2 + 1' }] }
 * 拼接所有 text child 即得 LaTeX 源码.
 */
function extractMathLatex(atom: Atom): string {
  const children = atom.content;
  if (!Array.isArray(children) || children.length === 0) return '';
  return children
    .map((c) => (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('');
}

/**
 * 未识别 atom 的降级渲染:构造一个虚拟 textBlock,内容是 ASCII 占位
 * (避免 emoji 字体回退缺失;占位文字不可编辑,只是视觉提示).
 *
 * 详见 docs/graph/canvas/Canvas-M2.1-TextNode-Spec.md §2.3
 */
async function renderUnknownAtom(
  atom: Atom,
  yOffset: number,
  contentWidth: number,
): Promise<{ svg: string; height: number }> {
  const label = unknownAtomLabel(atom.type);
  const placeholderAtom: Atom = {
    type: 'textBlock',
    content: [{ type: 'text', text: label }],
  };
  return renderTextBlock(placeholderAtom, yOffset, contentWidth);
}

/** 把未识别的 atom 类型映射成简短占位标签(纯 ASCII,避免 emoji 字体缺失) */
function unknownAtomLabel(atomType: string): string {
  switch (atomType) {
    case 'image':         return '[Image]';
    case 'video':         return '[Video]';
    case 'audio':         return '[Audio]';
    case 'tweet':         return '[Tweet]';
    case 'codeBlock':     return '[Code]';
    case 'table':         return '[Table]';
    case 'columnList':    return '[Columns]';
    case 'frameBlock':    return '[Frame]';
    case 'callout':       return '[Callout]';
    case 'blockquote':    return '[Quote]';
    case 'toggleList':    return '[Toggle]';
    case 'externalRef':   return '[Ref]';
    case 'fileBlock':     return '[File]';
    case 'htmlBlock':     return '[HTML]';
    case 'mathVisual':    return '[Diagram]';
    case 'horizontalRule': return '---';
    case 'pageAnchor':    return '[Anchor]';
    case 'taskList':      return '[Tasks]';
    default:              return `[${atomType}]`;
  }
}

function wrapSvg(inner: string, w: number, h: number): string {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${inner}</svg>`;
}

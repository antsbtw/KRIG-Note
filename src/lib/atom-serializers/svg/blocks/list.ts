/**
 * bulletList / orderedList 序列化.
 *
 * NoteView schema(权威源,plugins/note/blocks/bullet-list.ts):
 *   content: 'block+'  ← 直接含 textBlock / nested list,**没有 listItem 包装**
 *
 * 形态:
 *   bulletList {
 *     content: [
 *       textBlock,           // 列表项 1
 *       textBlock,           // 列表项 2
 *       bulletList,          // 嵌套子列表(缩进 +1 级渲染)
 *     ]
 *   }
 *
 * 渲染策略:
 * - 每个 textBlock child = 一个列表项,画 bullet/number + 缩进文本
 * - 嵌套 list child 缩进递归,自身不画 bullet(由子 list 的项画)
 */
import type { Atom } from '../../types';
import { renderTextBlock } from './textBlock';
import { textToPath } from '../text-to-path';

const INDENT_PER_LEVEL = 16;
const BULLET_DIAMETER = 4;
const BULLET_X_OFFSET = 4; // bullet 中心相对 indent 起点的偏移
const BULLET_FILL = '#cccccc';
const NUMBER_FONT_SIZE = 14;

export async function renderList(
  atom: Atom,
  yOffset: number,
  ordered: boolean,
  depth = 0,
): Promise<{ svg: string; height: number }> {
  if (!atom.content || atom.content.length === 0) return { svg: '', height: 0 };

  const parts: string[] = [];
  let y = yOffset;
  let index = 1;

  const indent = INDENT_PER_LEVEL * (depth + 1);

  // NoteView schema(权威源):bulletList/orderedList content='block+',
  // 子元素直接是 textBlock/嵌套 list,**没有 listItem 中间层**.
  // 序列化器适配此结构:每个 textBlock child = 一个列表项,嵌套 list 缩进递归.
  for (const child of atom.content) {
    if (!child) continue;
    const childYStart = y;

    if (child.type === 'textBlock') {
      const { svg, height } = await renderIndentedTextBlock(child, y, indent);
      if (svg) parts.push(svg);

      // 在文本基线位置画 bullet / number(baselineY 与 textBlock 内 baseline 算法一致)
      const baselineY = childYStart + 14 + 2;
      if (ordered) {
        const text = `${index}.`;
        const numX = indent - INDENT_PER_LEVEL + BULLET_X_OFFSET;
        const r = await textToPath(text, NUMBER_FONT_SIZE, numX, baselineY, BULLET_FILL);
        if (r.svg) parts.push(r.svg);
      } else {
        const cx = indent - INDENT_PER_LEVEL + BULLET_X_OFFSET + BULLET_DIAMETER / 2;
        const cy = baselineY - NUMBER_FONT_SIZE / 2 + 1;
        parts.push(circlePath(cx, cy, BULLET_DIAMETER / 2));
      }

      y += height;
      index++;
    } else if (child.type === 'bulletList') {
      // 嵌套无序列表:缩进 +1 级,index 不增(嵌套 list 不算父列表的项)
      const { svg, height } = await renderList(child, y, false, depth + 1);
      if (svg) parts.push(svg);
      y += height;
    } else if (child.type === 'orderedList') {
      const { svg, height } = await renderList(child, y, true, depth + 1);
      if (svg) parts.push(svg);
      y += height;
    }
    // 其他 block(如 callout / mathBlock 嵌入列表)暂跳过,不破坏布局
  }

  return { svg: parts.join(''), height: y - yOffset };
}

/**
 * 缩进版 textBlock：renderTextBlock 的内容统一向右平移 indent。
 * 简化做法：在外层 SVG 包一个 transform="translate(indent, 0)"。
 */
async function renderIndentedTextBlock(
  atom: Atom,
  yOffset: number,
  indent: number,
): Promise<{ svg: string; height: number }> {
  const { svg, height } = await renderTextBlock(atom, yOffset);
  if (!svg) return { svg: '', height };
  // 包一层 transform（SVGLoader 解析嵌套 g 没问题）
  return {
    svg: `<g transform="translate(${indent}, 0)">${svg}</g>`,
    height,
  };
}

function circlePath(cx: number, cy: number, r: number): string {
  // SVG path: 圆 = M(cx-r,cy) a r r 0 1 0 (2r) 0 a r r 0 1 0 -(2r) 0
  return `<path d="M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0" fill="${BULLET_FILL}" />`;
}

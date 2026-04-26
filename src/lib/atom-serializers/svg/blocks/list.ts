/**
 * bulletList / orderedList 序列化。
 *
 * Note 系统结构（v1.3 § 4.2 P1 Block）：
 *   bulletList { content: [listItem { content: [textBlock | nested list] }] }
 *
 * 渲染策略：
 * - 每个 listItem 依据其在父 list 中的索引画 bullet（圆点）或编号（数字 path）
 * - 缩进 INDENT_PER_LEVEL × depth（嵌套层级）
 * - listItem 内可嵌套子 list / paragraph，递归处理
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

  for (const item of atom.content) {
    if (item.type !== 'listItem' || !item.content) continue;

    // listItem 内部：逐 child 渲染（textBlock 直接画，嵌套 list 递归）
    let firstBlockY = y;
    let firstBlockBaselineY = -1;

    for (const child of item.content) {
      const childYStart = y;
      let res: { svg: string; height: number } = { svg: '', height: 0 };

      if (child.type === 'textBlock') {
        res = await renderIndentedTextBlock(child, y, indent);
      } else if (child.type === 'bulletList') {
        res = await renderList(child, y, false, depth + 1);
      } else if (child.type === 'orderedList') {
        res = await renderList(child, y, true, depth + 1);
      }

      if (res.svg) parts.push(res.svg);

      // 第一个 block 决定 bullet/number 的 y 位置
      if (firstBlockBaselineY < 0 && child.type === 'textBlock') {
        firstBlockBaselineY = childYStart + 14 + 2; // baselineY 与 textBlock 内一致
      }

      y += res.height;
    }

    // 在第一个 block 的位置画 bullet/number
    if (firstBlockBaselineY < 0) firstBlockBaselineY = firstBlockY + 16;

    if (ordered) {
      const text = `${index}.`;
      const numX = indent - INDENT_PER_LEVEL + BULLET_X_OFFSET;
      const { svg } = await textToPath(text, NUMBER_FONT_SIZE, numX, firstBlockBaselineY, BULLET_FILL);
      if (svg) parts.push(svg);
    } else {
      const cx = indent - INDENT_PER_LEVEL + BULLET_X_OFFSET + BULLET_DIAMETER / 2;
      const cy = firstBlockBaselineY - NUMBER_FONT_SIZE / 2 + 1;
      parts.push(circlePath(cx, cy, BULLET_DIAMETER / 2));
    }

    index++;
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

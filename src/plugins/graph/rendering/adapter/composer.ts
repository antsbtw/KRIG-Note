/**
 * 视觉合成 — substance.visual ⊕ presentation atom → ResolvedVisual。
 *
 * 合成顺序（spec §1.3.6）：
 *   系统默认 ⊕ substance.visual ⊕ presentation atom
 *   后者覆盖前者（浅合并，但深结构如 fill 子字段也合并）
 */
import type { ResolvedVisual } from './types';
import type { Substance, SubstanceVisual } from '../../substance/types';

/** 系统默认视觉（按几何 kind 区分） */
const DEFAULTS: Record<string, ResolvedVisual> = {
  point: {
    shape: 'circle',
    fill: { color: '#888888', opacity: 0.85 },
    border: { color: '#aaaaaa', width: 1, style: 'solid' },
    text: { color: '#ffffff', size: 12, weight: 400 },
    size: { width: 60, height: 60 },
    labelLayout: 'below-center',
  },
  line: {
    shape: 'line',
    border: { color: '#888888', width: 1, style: 'solid' },
    text: { color: '#666666', size: 10, weight: 400 },
    labelLayout: 'below-center',
  },
  surface: {
    shape: 'polygon',
    fill: { color: '#444444', opacity: 0.15 },
    border: { color: '#888888', width: 1, style: 'dashed' },
    text: { color: '#aaaaaa', size: 11, weight: 400 },
    labelLayout: 'above-center',
  },
  volume: {
    shape: 'polyhedron',
    fill: { color: '#444444', opacity: 0.1 },
    border: { color: '#888888', width: 1, style: 'solid' },
    labelLayout: 'above-center',
  },
};

/** 浅合并 SubstanceVisual 到 ResolvedVisual（保留嵌套结构） */
function mergeSubstanceVisual(base: ResolvedVisual, patch?: SubstanceVisual): ResolvedVisual {
  if (!patch) return base;
  return {
    shape: patch.shape ?? base.shape,
    fill: patch.fill ? { ...base.fill, ...patch.fill } : base.fill,
    border: patch.border ? { ...base.border, ...patch.border } : base.border,
    text: patch.text ? { ...base.text, ...patch.text } : base.text,
    size: patch.size ? { ...base.size, ...patch.size } : base.size,
    icon: patch.icon ?? base.icon,
    labelLayout: patch.labelLayout ?? base.labelLayout,
    labelMargin: patch.labelMargin ?? base.labelMargin,
    arrow: patch.arrow ?? base.arrow,
    arrowSize: patch.arrowSize ?? base.arrowSize,
  };
}

/** 应用单条 presentation atom 到 visual（attribute = 'fill.color' 等） */
function applyPresentation(visual: ResolvedVisual, attribute: string, value: string): ResolvedVisual {
  // 浅克隆（嵌套结构按需克隆）
  const next: ResolvedVisual = {
    ...visual,
    fill: visual.fill ? { ...visual.fill } : {},
    border: visual.border ? { ...visual.border } : {},
    text: visual.text ? { ...visual.text } : {},
    size: visual.size ? { ...visual.size } : {},
  };
  switch (attribute) {
    case 'shape': next.shape = value; break;
    case 'fill.color': next.fill!.color = value; break;
    case 'fill.opacity': next.fill!.opacity = parseFloat(value); break;
    case 'border.color': next.border!.color = value; break;
    case 'border.width': next.border!.width = parseFloat(value); break;
    case 'border.style': next.border!.style = value as 'solid' | 'dashed' | 'dotted'; break;
    case 'text.color': next.text!.color = value; break;
    case 'text.size': next.text!.size = parseFloat(value); break;
    case 'text.weight': next.text!.weight = parseFloat(value); break;
    case 'size.width': next.size!.width = parseFloat(value); break;
    case 'size.height': next.size!.height = parseFloat(value); break;
    case 'size.depth': next.size!.depth = parseFloat(value); break;
    case 'labelLayout': next.labelLayout = value; break;
    case 'labelMargin': next.labelMargin = parseFloat(value); break;
    case 'arrow': next.arrow = value as ResolvedVisual['arrow']; break;
    case 'arrowSize': next.arrowSize = parseFloat(value); break;
    // position.x/y/z + pinned 不影响 visual，由调用方单独处理
  }
  return next;
}

/**
 * 合成单个几何体的最终视觉。
 *
 * @param kind        几何体类型（决定默认）
 * @param substance   引用的物质（可能 undefined）
 * @param presentationAttrs  该 subject 的所有 presentation atoms (按 attribute 合成)
 */
export function composeVisual(
  kind: string,
  substance: Substance | undefined,
  presentationAttrs: Array<{ attribute: string; value: string }>,
): ResolvedVisual {
  let visual: ResolvedVisual = DEFAULTS[kind] ?? DEFAULTS.point;
  visual = mergeSubstanceVisual(visual, substance?.visual);
  for (const p of presentationAttrs) {
    visual = applyPresentation(visual, p.attribute, p.value);
  }
  return visual;
}

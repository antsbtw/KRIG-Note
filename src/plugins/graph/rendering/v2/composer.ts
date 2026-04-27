/**
 * 视觉合成器（spec §1.6 渲染合成顺序）。
 *
 * 最终视觉 = 系统默认 ⊕ substance.visual ⊕ presentation atoms
 *
 * 后者覆盖前者（浅合并）。位置由布局引擎单独算，不在合成范围内。
 */
import type {
  GraphGeometryRecord,
  GraphIntensionAtomRecord,
  GraphPresentationAtomRecord,
} from '../../../../main/storage/types';
import { substanceLibrary } from '../../substance';
import type { Substance, SubstanceVisual } from '../../substance/types';
import type { RenderableGeometry, ResolvedVisual } from './types';

// ── 系统默认视觉（按几何 kind 区分） ──

const DEFAULTS: Record<string, ResolvedVisual> = {
  point: {
    shape: 'circle',
    fill: { color: '#888888', opacity: 0.85 },
    border: { color: '#aaaaaa', width: 1, style: 'solid' },
    text: { color: '#ffffff', size: 12, weight: 400 },
    size: { width: 60, height: 60 },
  },
  line: {
    shape: 'line',
    fill: { color: '#888888', opacity: 1 },
    border: { color: '#888888', width: 1, style: 'solid' },
    text: { color: '#666666', size: 10, weight: 400 },
    size: { width: 0, height: 0 },
  },
  surface: {
    shape: 'polygon',
    fill: { color: '#444444', opacity: 0.15 },
    border: { color: '#888888', width: 1, style: 'dashed' },
    text: { color: '#aaaaaa', size: 11, weight: 400 },
    size: { width: 0, height: 0 },
  },
  volume: {
    shape: 'polyhedron',
    fill: { color: '#444444', opacity: 0.1 },
    border: { color: '#888888', width: 1, style: 'solid' },
    text: { color: '#aaaaaa', size: 11, weight: 400 },
    size: { width: 0, height: 0, depth: 0 },
  },
};

function deepMerge(base: ResolvedVisual, patch?: SubstanceVisual): ResolvedVisual {
  if (!patch) return base;
  return {
    shape: patch.shape ?? base.shape,
    fill: {
      color: patch.fill?.color ?? base.fill.color,
      opacity: patch.fill?.opacity ?? base.fill.opacity,
    },
    border: {
      color: patch.border?.color ?? base.border.color,
      width: patch.border?.width ?? base.border.width,
      style: patch.border?.style ?? base.border.style,
    },
    text: {
      color: patch.text?.color ?? base.text.color,
      size: patch.text?.size ?? base.text.size,
      weight: patch.text?.weight ?? base.text.weight,
    },
    size: {
      width: patch.size?.width ?? base.size.width,
      height: patch.size?.height ?? base.size.height,
      depth: patch.size?.depth ?? base.size.depth,
    },
  };
}

/**
 * 把单条 presentation atom 合并到 visual。
 * presentation atom 是细粒度的（attribute=fill.color / border.width / shape 等）。
 */
function applyPresentation(visual: ResolvedVisual, attribute: string, value: string): ResolvedVisual {
  const next = JSON.parse(JSON.stringify(visual)) as ResolvedVisual;
  switch (attribute) {
    case 'shape':
      next.shape = value;
      break;
    case 'fill.color':
      next.fill.color = value;
      break;
    case 'fill.opacity':
      next.fill.opacity = parseFloat(value);
      break;
    case 'border.color':
      next.border.color = value;
      break;
    case 'border.width':
      next.border.width = parseFloat(value);
      break;
    case 'border.style':
      next.border.style = value as 'solid' | 'dashed' | 'dotted';
      break;
    case 'text.color':
      next.text.color = value;
      break;
    case 'text.size':
      next.text.size = parseFloat(value);
      break;
    case 'text.weight':
      next.text.weight = parseFloat(value);
      break;
    case 'size.width':
      next.size.width = parseFloat(value);
      break;
    case 'size.height':
      next.size.height = parseFloat(value);
      break;
    case 'size.depth':
      next.size.depth = parseFloat(value);
      break;
    // position.x / position.y / position.z / pinned 不影响视觉，由 GraphRenderer 单独处理
  }
  return next;
}

export interface ComposedScene {
  /** 按 geometry id 索引 */
  geometries: Map<string, RenderableGeometry>;
}

/**
 * 合成完整渲染场景。
 *
 * @param geometries - DB 几何骨架
 * @param intensions - DB 内涵 atom（提取 label / substance 引用）
 * @param presentations - DB 视觉 atom（按 layout 已过滤）
 * @returns 一组 RenderableGeometry，每条含完整合成后的视觉参数 + 可选位置 + pin 状态
 */
export function compose(
  geometries: GraphGeometryRecord[],
  intensions: GraphIntensionAtomRecord[],
  presentations: GraphPresentationAtomRecord[],
): ComposedScene {
  // 按 subject 分组
  const intensionsBySubject = new Map<string, GraphIntensionAtomRecord[]>();
  for (const a of intensions) {
    const list = intensionsBySubject.get(a.subject_id) ?? [];
    list.push(a);
    intensionsBySubject.set(a.subject_id, list);
  }

  const presentationsBySubject = new Map<string, GraphPresentationAtomRecord[]>();
  for (const p of presentations) {
    const list = presentationsBySubject.get(p.subject_id) ?? [];
    list.push(p);
    presentationsBySubject.set(p.subject_id, list);
  }

  const result = new Map<string, RenderableGeometry>();

  for (const g of geometries) {
    const subjectIntensions = intensionsBySubject.get(g.id) ?? [];
    const subjectPresentations = presentationsBySubject.get(g.id) ?? [];

    // ── 提取 label ──
    const labelAtom = subjectIntensions.find((i) => i.predicate === 'label');
    const label = labelAtom?.value;

    // ── 解析 substance 引用 ──
    const substanceAtom = subjectIntensions.find((i) => i.predicate === 'substance');
    let substance: Substance | undefined;
    if (substanceAtom) {
      substance = substanceLibrary.get(substanceAtom.value);
      if (!substance) {
        console.warn(`[composer] substance "${substanceAtom.value}" not found for geometry ${g.id}`);
      }
    }

    // ── 合成视觉 ──
    let visual = DEFAULTS[g.kind] ?? DEFAULTS.point;
    visual = deepMerge(visual, substance?.visual);
    for (const p of subjectPresentations) {
      visual = applyPresentation(visual, p.attribute, p.value);
    }

    // ── 提取位置 + pin ──
    let position: { x: number; y: number; z?: number } | undefined;
    let pinned = false;
    let posX: number | undefined;
    let posY: number | undefined;
    let posZ: number | undefined;
    for (const p of subjectPresentations) {
      if (p.attribute === 'position.x') posX = parseFloat(p.value);
      else if (p.attribute === 'position.y') posY = parseFloat(p.value);
      else if (p.attribute === 'position.z') posZ = parseFloat(p.value);
      else if (p.attribute === 'pinned' && p.value === 'true') pinned = true;
    }
    if (posX !== undefined && posY !== undefined) {
      position = { x: posX, y: posY, ...(posZ !== undefined ? { z: posZ } : {}) };
    }

    result.set(g.id, {
      geometry: g,
      label,
      substance,
      visual,
      position,
      pinned,
    });
  }

  return { geometries: result };
}

import type { Instance, SubstanceDef } from '../../library/types';
import { SubstanceRegistry } from '../../library/substances';
import type { NodeRenderer } from '../scene/NodeRenderer';
import type { SceneManager } from '../scene/SceneManager';

/**
 * Canvas note 序列化 / 反序列化(spec Canvas.md §4.1)
 *
 * 输出形状:
 * {
 *   schema_version: 2,
 *   view: { centerX, centerY, zoom },        // Freeform 风格视口
 *   instances: [Instance, ...],
 *   user_substances?: [SubstanceDef, ...],
 * }
 *
 * v1 = 旧格式 viewBox: {x,y,w,h}(已弃用,deserialize 兼容读取)
 * v2 = 新格式 view: {centerX, centerY, zoom}(无量纲缩放,与容器尺寸解耦)
 *
 * user_substances 是 v1 临时字段:M2 后改为独立 note 存储。
 */

export const SCHEMA_VERSION = 2;

export interface CanvasDocument {
  schema_version: number;
  /** Freeform 风格视口:中心世界坐标 + 无量纲 zoom */
  view: { centerX: number; centerY: number; zoom: number };
  instances: Instance[];
  user_substances?: SubstanceDef[];
}

/** v1 兼容:旧文档形状(deserialize 容错读取) */
interface CanvasDocumentV1 {
  schema_version: 1;
  viewBox: { x: number; y: number; w: number; h: number };
  instances: Instance[];
  user_substances?: SubstanceDef[];
}

// ─────────────────────────────────────────────────────────
// serialize
// ─────────────────────────────────────────────────────────

export function serialize(nr: NodeRenderer, sm: SceneManager): CanvasDocument {
  const view = sm.getView();
  const instances = nr.listInstances();

  // 收集用户创建的 substance(source='user' 的需要嵌入文档,builtin 不需要)
  const userRefs = new Set<string>();
  for (const inst of instances) {
    if (inst.type === 'substance') userRefs.add(inst.ref);
  }
  const userSubstances: SubstanceDef[] = [];
  for (const ref of userRefs) {
    const def = SubstanceRegistry.get(ref);
    if (def && def.source === 'user') userSubstances.push(def);
  }

  return {
    schema_version: SCHEMA_VERSION,
    view: {
      centerX: view.centerX,
      centerY: view.centerY,
      zoom: view.zoom,
    },
    instances: instances.map(cloneInstance),
    user_substances: userSubstances.length > 0 ? userSubstances : undefined,
  };
}

// ─────────────────────────────────────────────────────────
// deserialize
// ─────────────────────────────────────────────────────────

export interface DeserializeResult {
  instanceCount: number;
  skipped: string[];
  warnings: string[];
}

export function deserialize(
  doc: CanvasDocument | CanvasDocumentV1,
  nr: NodeRenderer,
  sm: SceneManager,
): DeserializeResult {
  const result: DeserializeResult = {
    instanceCount: 0,
    skipped: [],
    warnings: [],
  };

  if (!doc || typeof doc !== 'object') {
    result.warnings.push('document is not an object');
    return result;
  }

  // 1. 注册 user_substances(必须在 setInstances 之前)
  for (const def of doc.user_substances ?? []) {
    if (!def.id || !Array.isArray(def.components)) {
      result.warnings.push(`malformed user substance: ${def?.id ?? '<no-id>'}`);
      continue;
    }
    SubstanceRegistry.register(def);
  }

  // 2. 验证 instance,跳过无效的;清洗异常 size/position(防御历史脏数据)
  const validInstances: Instance[] = [];
  for (const inst of (doc as CanvasDocument).instances ?? []) {
    if (!inst || !inst.id || !inst.ref || !inst.type) {
      result.skipped.push(inst?.id ?? '<no-id>');
      continue;
    }
    const cloned = cloneInstance(inst);
    const sanitizeWarn = sanitizeInstance(cloned);
    if (sanitizeWarn) result.warnings.push(`${cloned.id}: ${sanitizeWarn}`);
    validInstances.push(cloned);
  }
  result.instanceCount = validInstances.length;

  // 3. 装配画板
  nr.setInstances(validInstances);

  // 4. 恢复视图
  // v2:直接用 view.{centerX, centerY, zoom}
  // v1(legacy):viewBox.{x,y,w,h} 已弃用,zoom 无法精确恢复(需要容器尺寸,
  //   而旧文档没存)。简化:v1 文档丢弃视口,让 SceneManager 用初始 zoom=1
  if (isV2(doc)) {
    const v = doc.view;
    if (Number.isFinite(v.centerX) && Number.isFinite(v.centerY) &&
        Number.isFinite(v.zoom) && v.zoom > 0) {
      sm.setView(v.centerX, v.centerY, v.zoom);
    }
  } else if (isV1(doc)) {
    result.warnings.push('schema_version=1 (legacy viewBox), view not restored');
    // 不调 setView,SceneManager 保持初始 zoom=1 + viewCenter 在容器中心
  } else {
    const v = (doc as { schema_version?: unknown }).schema_version;
    result.warnings.push(`unknown schema_version ${String(v)}`);
  }

  return result;
}

function isV2(doc: CanvasDocument | CanvasDocumentV1): doc is CanvasDocument {
  return doc.schema_version === SCHEMA_VERSION
    && 'view' in doc
    && doc.view !== null
    && typeof doc.view === 'object';
}

function isV1(doc: CanvasDocument | CanvasDocumentV1): doc is CanvasDocumentV1 {
  return doc.schema_version === 1 && 'viewBox' in doc;
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

/** 深拷贝 instance(避免外部修改原始引用) */
function cloneInstance(inst: Instance): Instance {
  return JSON.parse(JSON.stringify(inst));
}

/**
 * 清洗 instance:把 NaN/Infinity/超大值钳制成合理范围
 * 返回 warning 字符串(若有改动);返回 null 表示数据正常
 *
 * 防御场景:历史 bug 把 size 写成天文数字 → 持久化 → 重新加载时
 * 渲染层会因数值溢出整体崩坏(整画布被 stretch 的 mesh 覆盖)
 */
function sanitizeInstance(inst: Instance): string | null {
  // 普通 shape:size 单边最大 10000 px(再大就视觉异常,远超合理画板用例)
  // line:size 是 endpoints 的 AABB,跨度可能很大,放宽到 50000
  const isLine = inst.type === 'shape' && /^krig\.line\./.test(inst.ref);
  const SIZE_MAX = isLine ? 50000 : 10000;
  const SIZE_MIN = 1;
  const POS_MAX = 1e6;        // position 最大 ±1e6(远超合理画板范围)
  const issues: string[] = [];

  if (inst.size) {
    const sw = Number(inst.size.w);
    const sh = Number(inst.size.h);
    if (!Number.isFinite(sw) || sw > SIZE_MAX || sw < SIZE_MIN) {
      issues.push(`size.w=${inst.size.w} → 100`);
      inst.size.w = 100;
    }
    if (!Number.isFinite(sh) || sh > SIZE_MAX || sh < SIZE_MIN) {
      issues.push(`size.h=${inst.size.h} → 100`);
      inst.size.h = 100;
    }
  }
  if (inst.position) {
    const px = Number(inst.position.x);
    const py = Number(inst.position.y);
    if (!Number.isFinite(px) || Math.abs(px) > POS_MAX) {
      issues.push(`position.x=${inst.position.x} → 0`);
      inst.position.x = 0;
    }
    if (!Number.isFinite(py) || Math.abs(py) > POS_MAX) {
      issues.push(`position.y=${inst.position.y} → 0`);
      inst.position.y = 0;
    }
  }
  if (inst.rotation !== undefined) {
    const r = Number(inst.rotation);
    if (!Number.isFinite(r)) {
      issues.push(`rotation=${inst.rotation} → 0`);
      inst.rotation = 0;
    }
  }
  return issues.length ? issues.join(', ') : null;
}

/** 创建空文档(给 NavSide "+ 新建画板"用) */
export function createEmptyDocument(): CanvasDocument {
  return {
    schema_version: SCHEMA_VERSION,
    view: { centerX: 0, centerY: 0, zoom: 1 },
    instances: [],
  };
}

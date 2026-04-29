import type { Instance, SubstanceDef } from '../../library/types';
import { SubstanceRegistry } from '../../library/substances';
import type { NodeRenderer } from '../scene/NodeRenderer';
import type { SceneManager } from '../scene/SceneManager';

/**
 * Canvas note 序列化 / 反序列化(spec Canvas.md §4.1)
 *
 * 输出形状:
 * {
 *   schema_version: 1,
 *   viewBox: { x, y, w, h },        // 视口(camera frustum left/top/width/height)
 *   instances: [Instance, ...],
 *   user_substances?: [SubstanceDef, ...],  // 用户创建的 substance(source='user')
 * }
 *
 * user_substances 是 v1 临时字段:M1.5b 接通 note-store 后,每个 user substance
 * 存为独立 note,不再嵌在 canvas note 里。M1.5a 阶段先内嵌,保证序列化往返
 * 完整(刷新或重新打开后用户自创 substance 不丢)。
 */

export const SCHEMA_VERSION = 1;

export interface CanvasDocument {
  schema_version: number;
  viewBox: { x: number; y: number; w: number; h: number };
  instances: Instance[];
  /** 用户在该画板创建的 substance 定义(M1.5b 后改为独立 note) */
  user_substances?: SubstanceDef[];
}

// ─────────────────────────────────────────────────────────
// serialize
// ─────────────────────────────────────────────────────────

export function serialize(nr: NodeRenderer, sm: SceneManager): CanvasDocument {
  const view = sm.getView();
  const halfW = view.viewWidth / 2;
  const halfH = view.viewHeight / 2;

  const instances = nr.listInstances();

  // 收集用户创建的 substance:扫所有 substance instance,去重 ref;
  // 只保留 source='user' 的(builtin 不需要存,启动时 bootstrap 会重新注册)
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
    viewBox: {
      x: view.centerX - halfW,
      y: view.centerY - halfH,
      w: view.viewWidth,
      h: view.viewHeight,
    },
    instances: instances.map(cloneInstance),
    user_substances: userSubstances.length > 0 ? userSubstances : undefined,
  };
}

// ─────────────────────────────────────────────────────────
// deserialize
// ─────────────────────────────────────────────────────────

export interface DeserializeResult {
  /** 该 doc 中的 instance 总数 */
  instanceCount: number;
  /** 因 ref 找不到而被跳过的 instance id 列表 */
  skipped: string[];
  /** schema_version 不识别时的 fallback warning */
  warnings: string[];
}

export function deserialize(
  doc: CanvasDocument,
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
  if (doc.schema_version !== SCHEMA_VERSION) {
    result.warnings.push(`unknown schema_version ${doc.schema_version}, expected ${SCHEMA_VERSION}`);
    // 仍尝试加载,容错优于拒绝
  }

  // 1. 注册 user_substances(必须在 setInstances 之前,否则 substance 实例渲染不出)
  for (const def of doc.user_substances ?? []) {
    if (!def.id || !Array.isArray(def.components)) {
      result.warnings.push(`malformed user substance: ${def?.id ?? '<no-id>'}`);
      continue;
    }
    SubstanceRegistry.register(def);
  }

  // 2. 验证每个 instance 的 ref 有效;跳过无效的
  const validInstances: Instance[] = [];
  for (const inst of doc.instances ?? []) {
    if (!inst || !inst.id || !inst.ref || !inst.type) {
      result.skipped.push(inst?.id ?? '<no-id>');
      continue;
    }
    validInstances.push(cloneInstance(inst));
  }
  result.instanceCount = validInstances.length;

  // 3. 装配画板
  nr.setInstances(validInstances);

  // 4. 恢复视口(viewBox → setView)
  if (doc.viewBox && Number.isFinite(doc.viewBox.w) && doc.viewBox.w > 0) {
    const cx = doc.viewBox.x + doc.viewBox.w / 2;
    const cy = doc.viewBox.y + doc.viewBox.h / 2;
    sm.setView(cx, cy, doc.viewBox.w);
  }

  return result;
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

/** 深拷贝 instance(避免外部修改原始引用) */
function cloneInstance(inst: Instance): Instance {
  return JSON.parse(JSON.stringify(inst));
}

/** 创建空文档(给 NavSide "+ 新建画板"用) */
export function createEmptyDocument(viewWidth = 1920, viewHeight = 1080): CanvasDocument {
  return {
    schema_version: SCHEMA_VERSION,
    viewBox: { x: 0, y: 0, w: viewWidth, h: viewHeight },
    instances: [],
  };
}

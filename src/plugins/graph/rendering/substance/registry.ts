/**
 * Substance Library 注册表（视图物质库）。
 *
 * 三个层级（v1 仅 built-in）：
 * - built-in：KRIG 内置物质包（代码注册）
 * - themes：主题包（v2.x）
 * - user：用户自定义物质（v2.x，存 JSON 文件）
 *
 * 使用：
 *   import { substanceLibrary } from '.../substance';
 *   substanceLibrary.register({ id: 'krig-layer', visual: { ... } });
 *   substanceLibrary.get('krig-layer');
 */
import type { Substance, GeometryKind } from './types';

class SubstanceLibrary {
  private store = new Map<string, Substance>();

  /** 注册一个物质。同 id 重复注册会覆盖（最后注册者生效）。 */
  register(substance: Substance): void {
    this.store.set(substance.id, substance);
  }

  /** 获取物质定义。不存在返回 undefined（渲染层兜底默认）。 */
  get(id: string): Substance | undefined {
    return this.store.get(id);
  }

  /** 列出物质。可按 kind 过滤（applies_to_kinds 包含该 kind 或为空）。 */
  list(filter?: { kind?: GeometryKind }): Substance[] {
    const all = Array.from(this.store.values());
    if (!filter?.kind) return all;
    return all.filter((s) =>
      !s.applies_to_kinds || s.applies_to_kinds.length === 0 || s.applies_to_kinds.includes(filter.kind!)
    );
  }

  /** 注销物质（v2 用户自定义场景） */
  unregister(id: string): boolean {
    return this.store.delete(id);
  }

  /** 清空（测试用） */
  clear(): void {
    this.store.clear();
  }
}

export const substanceLibrary = new SubstanceLibrary();

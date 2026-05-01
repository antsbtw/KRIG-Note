/// <reference types="vite/client" />
import type { ShapeDef, ShapeCategory, ShapePack } from '../types';

/**
 * ShapeRegistry — 全系统共享的 shape 资源注册表
 *
 * v1 不做渲染,只做"注册 / 查询";渲染由 M1.1b 的 parametric renderer 接管。
 * 启动时 bootstrap() 会通过 import.meta.glob 自动收齐 definitions/ 下的所有 JSON。
 */
class ShapeRegistryImpl {
  private byId = new Map<string, ShapeDef>();
  private bootstrapped = false;

  register(def: ShapeDef): void {
    if (this.byId.has(def.id)) {
      console.warn(`[ShapeRegistry] duplicate id ignored: ${def.id}`);
      return;
    }
    this.byId.set(def.id, def);
  }

  registerPack(pack: ShapePack): void {
    for (const def of pack.shapes) this.register(def);
  }

  get(id: string): ShapeDef | null {
    return this.byId.get(id) ?? null;
  }

  list(): ShapeDef[] {
    return Array.from(this.byId.values());
  }

  listByCategory(category: ShapeCategory): ShapeDef[] {
    return this.list().filter((s) => s.category === category);
  }

  /**
   * 启动时一次性收齐所有内置 shape JSON。
   * 重复调用安全(幂等)。
   */
  bootstrap(): void {
    if (this.bootstrapped) return;
    const modules = import.meta.glob<{ default: ShapeDef }>(
      './definitions/**/*.json',
      { eager: true },
    );
    for (const path in modules) {
      const def = modules[path].default;
      if (!def || !def.id) {
        console.warn(`[ShapeRegistry] skipped malformed shape JSON: ${path}`);
        continue;
      }
      this.register(def);
    }
    this.bootstrapped = true;
  }

  /** 仅供测试:重置 registry */
  _resetForTest(): void {
    this.byId.clear();
    this.bootstrapped = false;
  }
}

export const ShapeRegistry = new ShapeRegistryImpl();

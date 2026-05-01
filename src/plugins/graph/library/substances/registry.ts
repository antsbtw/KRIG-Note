/// <reference types="vite/client" />
import type { SubstanceDef, SubstancePack } from '../types';

/**
 * SubstanceRegistry — 全系统共享的 substance 资源注册表
 *
 * v1 只管"内置 substance"的注册 / 查询;用户自创 substance 在 v1.1 接 note-store
 * (每个一篇 note,见 Library.md §7.2)。
 *
 * 启动时 bootstrap() 通过 import.meta.glob 自动收齐 definitions/ 下的 JSON。
 */
class SubstanceRegistryImpl {
  private byId = new Map<string, SubstanceDef>();
  private bootstrapped = false;

  register(def: SubstanceDef): void {
    if (this.byId.has(def.id)) {
      console.warn(`[SubstanceRegistry] duplicate id ignored: ${def.id}`);
      return;
    }
    this.byId.set(def.id, def);
  }

  registerPack(pack: SubstancePack): void {
    for (const def of pack.substances) this.register(def);
  }

  get(id: string): SubstanceDef | null {
    return this.byId.get(id) ?? null;
  }

  list(): SubstanceDef[] {
    return Array.from(this.byId.values());
  }

  listByCategory(category: string): SubstanceDef[] {
    return this.list().filter((s) => s.category === category);
  }

  bootstrap(): void {
    if (this.bootstrapped) return;
    const modules = import.meta.glob<{ default: SubstanceDef }>(
      './definitions/**/*.json',
      { eager: true },
    );
    for (const path in modules) {
      const def = modules[path].default;
      if (!def || !def.id) {
        console.warn(`[SubstanceRegistry] skipped malformed substance JSON: ${path}`);
        continue;
      }
      this.register(def);
    }
    this.bootstrapped = true;
  }

  _resetForTest(): void {
    this.byId.clear();
    this.bootstrapped = false;
  }
}

export const SubstanceRegistry = new SubstanceRegistryImpl();

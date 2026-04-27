/**
 * 解析器注册表 — 关系类 predicate + value_kind 推断器。
 *
 * 关系类 predicate 双重身份：写 `contains :: [[x]]` 时
 * 1. 创建 intension atom（subject=this, predicate=contains, value=x）
 * 2. 同时创建一个 Line 几何体（members=[this, x]）（generateGeometry='line'）
 *
 * 特殊关系 'boundary'：addToMembers=true，把 value 加到当前几何体的 members
 *                      （用于 Surface / Volume 声明边界）
 */

// ── 关系类 predicate 注册 ──

export interface RelationPredicateConfig {
  predicate: string;
  /** 'line' = 同时生成一个 Line 几何体；undefined = 不生成 */
  generateGeometry?: 'line';
  /** true = 把 value 加到当前几何体的 members（Surface/Volume 用） */
  addToMembers?: boolean;
}

class RelationPredicateRegistry {
  private store = new Map<string, RelationPredicateConfig>();

  register(config: RelationPredicateConfig): void {
    this.store.set(config.predicate, config);
  }

  get(predicate: string): RelationPredicateConfig | undefined {
    return this.store.get(predicate);
  }

  has(predicate: string): boolean {
    return this.store.has(predicate);
  }

  list(): RelationPredicateConfig[] {
    return Array.from(this.store.values());
  }
}

export const relationPredicateRegistry = new RelationPredicateRegistry();

// 内置关系类（v1）
relationPredicateRegistry.register({ predicate: 'contains',   generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'refs',       generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'references', generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'routes-to',  generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'defines',    generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'links-to',   generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'links_to',   generateGeometry: 'line' });
relationPredicateRegistry.register({ predicate: 'boundary',   addToMembers: true });

// ── value_kind 推断器 ──

export type IntensionValueKind = 'text' | 'code' | 'ref' | 'number' | 'url';

export interface ValueKindRule {
  test: (s: string) => boolean;
  kind: IntensionValueKind;
}

class ValueKindRegistry {
  private rules: ValueKindRule[] = [];

  /** 按注册顺序匹配，第一个命中为准。默认（无规则匹配）= 'text'。 */
  register(rule: ValueKindRule): void {
    this.rules.push(rule);
  }

  infer(value: string): IntensionValueKind {
    for (const rule of this.rules) {
      if (rule.test(value)) return rule.kind;
    }
    return 'text';
  }
}

export const valueKindRegistry = new ValueKindRegistry();

// 内置规则（按优先级顺序）
valueKindRegistry.register({ test: (s) => /^\[\[[a-z0-9-]+\]\]$/.test(s), kind: 'ref' });
valueKindRegistry.register({ test: (s) => /^https?:\/\//.test(s),         kind: 'url' });
valueKindRegistry.register({ test: (s) => /^-?\d+(\.\d+)?$/.test(s),      kind: 'number' });
valueKindRegistry.register({ test: (s) => /^`.*`$/.test(s),               kind: 'code' });
// 默认 text（valueKindRegistry.infer 兜底）

/**
 * 导入 handler — 协调解析器 + stores 写入。
 *
 * 流程：
 *   读文件 → parseMarkdown → 创建 graph → 把临时 id 映射为 DB id
 *   → 批量写 geometries → 批量写 intensions
 *   → 广播 GRAPH_LIST_CHANGED → 返回 graphId + stats
 *
 * 关键：解析器输出的 id 是用户友好的临时 id（如 `application`、`line:foo->bar:contains`）。
 * 导入时给每条几何体分配一个新的 DB id（避免 id 冲突 + 避免 SurrealDB 特殊字符问题），
 * 同时把临时 id → DB id 的映射表用来 rewrite intension atom 的 subject_id 和
 * geometry.members 中的引用。
 */
import * as fs from 'fs/promises';
import { parseMarkdown, type ParseResult } from './parser';
import { graphViewStore } from '../../../../main/storage/graphview-store';
import { graphGeometryStore } from '../../../../main/storage/graph-geometry-store';
import { graphIntensionAtomStore } from '../../../../main/storage/graph-intension-atom-store';
import type { GraphVariant } from '../../../../main/storage/types';

export interface ImportResult {
  graphId: string;
  stats: { geometries: number; intensions: number };
  warnings: string[];
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 从 Markdown 文件导入图谱。
 */
export async function importFromMarkdown(filePath: string): Promise<ImportResult> {
  const content = await fs.readFile(filePath, 'utf-8');
  const parsed = parseMarkdown(content);
  return importParseResult(parsed);
}

/**
 * 把 ParseResult 写入 DB（不读文件版本，便于测试 / 字符串导入）。
 */
export async function importParseResult(result: ParseResult): Promise<ImportResult> {
  // ── 1. 创建 graph 主记录 ──
  const variant = (result.meta.graph_variant as GraphVariant) || 'knowledge';
  const graph = await graphViewStore.create(
    result.meta.title || '导入的图谱',
    null,
    variant,
  );
  const graphId = graph.id;

  // ── 2. 设置 active_layout / dimension 等 frontmatter（如果指定） ──
  if (result.meta.active_layout) {
    await graphViewStore.setActiveLayout(graphId, result.meta.active_layout);
  }
  // dimension 暂时通过直接 SQL 写入（v1 graph store 接口未暴露 setDimension）
  // 默认是 2，frontmatter 想覆盖也只能改成 2，所以暂时不实现

  // 移到指定 folder（如果指定）
  if (result.meta.folder_id) {
    await graphViewStore.moveToFolder(graphId, result.meta.folder_id);
  }

  // ── 3. 给每条 geometry 分配 DB id，建立映射表 ──
  const idMap = new Map<string, string>();
  for (const g of result.geometries) {
    idMap.set(g.id, generateId());
  }

  // ── 4. 重写 members 引用（临时 id → DB id），过滤无效引用 ──
  const geometriesToWrite = result.geometries.map((g) => {
    const dbId = idMap.get(g.id)!;
    const remappedMembers = g.members
      .map((m) => idMap.get(m))
      .filter((id): id is string => !!id);
    return {
      id: dbId,
      graph_id: graphId,
      kind: g.kind,
      members: remappedMembers,
    };
  });

  await graphGeometryStore.createBulk(geometriesToWrite);

  // ── 5. 重写 intension atom 的 subject_id（临时 id → DB id） ──
  // value 中的 ref（如 contains 关系的 [[application-menu]] 解析后是 'application-menu'）
  // 也需要重写——让它们指向 DB id
  const intensionsToWrite = result.intensions
    .filter((i) => idMap.has(i.subject_id))  // 主语必须存在
    .map((i) => {
      const dbSubjectId = idMap.get(i.subject_id)!;
      let value = i.value;
      // ref 类型 + value 是临时 id → 重写
      if (i.value_kind === 'ref' && idMap.has(i.value)) {
        value = idMap.get(i.value)!;
      }
      // substance ref 不需要重写（指向 substance library，不是 graph 内部 id）
      // 但 predicate=substance 的 value_kind=ref 会被上面误重写——加 predicate 守护
      if (i.predicate === 'substance') {
        value = i.value;  // 还原
      }
      return {
        graph_id: graphId,
        subject_id: dbSubjectId,
        predicate: i.predicate,
        value,
        value_kind: i.value_kind,
        sort_order: i.sort_order,
      };
    });

  await graphIntensionAtomStore.createBulk(intensionsToWrite);

  return {
    graphId,
    stats: {
      geometries: geometriesToWrite.length,
      intensions: intensionsToWrite.length,
    },
    warnings: result.warnings,
  };
}

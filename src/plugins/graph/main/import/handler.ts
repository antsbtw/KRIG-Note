/**
 * 导入 handler — 协调解析器 + stores 写入。
 *
 * 流程：
 *   读文件 → parseMarkdown → 创建 graph → 批量写 geometries → 批量写 intensions
 *   → 广播 GRAPH_LIST_CHANGED → 返回 graphId + stats
 *
 * D11 阶段实现实际逻辑。本文件 D1 仅占位。
 */
import type { ParseResult } from './parser';

export interface ImportResult {
  graphId: string;
  stats: { geometries: number; intensions: number };
  warnings: string[];
}

/**
 * 从 Markdown 文件导入图谱。
 *
 * D11 实现。当前 D1 占位。
 */
export async function importFromMarkdown(filePath: string): Promise<ImportResult> {
  void filePath;
  throw new Error('importFromMarkdown not implemented yet (D11)');
}

/** 把 ParseResult 写入 DB（不读文件版本，便于测试） */
export async function importParseResult(result: ParseResult): Promise<ImportResult> {
  void result;
  throw new Error('importParseResult not implemented yet (D11)');
}

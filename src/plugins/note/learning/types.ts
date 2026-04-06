/**
 * 学习模块类型定义
 */

/** 词典查询结果 */
export interface LookupResult {
  word: string;
  definition: string;
  phonetic?: string;
  source: string;
}

/** 生词本条目 */
export interface VocabEntry {
  id: string;
  word: string;
  definition: string;
  context?: string;
  phonetic?: string;
  createdAt: number;
}

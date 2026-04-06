import type { LookupResult } from './providers/macos-dictionary';
import { macosLookup } from './providers/macos-dictionary';
import { googleTranslate } from './providers/google-translate';

/**
 * DictionaryService — 词典查询编排
 *
 * 依次尝试 provider：macOS Dictionary → Google Translate fallback
 */
export async function lookupWord(word: string): Promise<LookupResult | null> {
  // 1. macOS 原生词典
  const result = await macosLookup(word);
  if (result) return result;

  // 2. Google Translate 兜底（单词释义）
  const trans = await googleTranslate(word, 'zh-CN');
  if (trans) {
    return {
      word,
      definition: trans.text,
      source: 'Google Translate',
    };
  }

  return null;
}

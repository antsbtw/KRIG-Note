/**
 * learning — 学习模块公共 API
 */

export type { LookupResult, VocabEntry } from './types';

export {
  showDictionaryPanel,
  showTranslationPanel,
  hideDictionaryPanel,
  updateVocabList,
  isDictionaryPanelVisible,
} from './dictionary-panel';

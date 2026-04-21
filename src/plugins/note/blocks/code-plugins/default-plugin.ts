import type { CodeLanguagePlugin } from './types';

/**
 * Default Code Plugin — 纯代码，无 Preview
 *
 * 不需要注册，作为 fallback 使用。
 */

export const defaultCodePlugin: CodeLanguagePlugin = {
  languages: [],  // fallback，不匹配任何语言
  hasPreview: false,
};

import type { CodeLanguagePlugin } from './types';

/**
 * Code Language Plugin Registry
 *
 * 注册即生效 — 新增语言插件只需 import + register，不改 codeBlock 核心。
 */

const plugins = new Map<string, CodeLanguagePlugin>();

/** 注册一个语言插件 */
export function registerCodePlugin(plugin: CodeLanguagePlugin): void {
  for (const lang of plugin.languages) {
    plugins.set(lang, plugin);
  }
}

/** 查询语言对应的插件（无则返回 null） */
export function getCodePlugin(language: string): CodeLanguagePlugin | null {
  return plugins.get(language) ?? null;
}

/** 获取所有已注册的插件 */
export function getAllCodePlugins(): CodeLanguagePlugin[] {
  return [...new Set(plugins.values())];
}

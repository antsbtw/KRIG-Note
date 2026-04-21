/**
 * Code Language Plugins — 注册入口
 *
 * 新增语言插件：
 * 1. 创建 xxx-plugin.ts 实现 CodeLanguagePlugin 接口
 * 2. 在此文件 import + registerCodePlugin
 * 3. 不需要改 code-block.ts
 */

export { registerCodePlugin, getCodePlugin, getAllCodePlugins } from './registry';
export type { CodeLanguagePlugin, CodePluginContext, ToolbarButtonDef } from './types';
export { defaultCodePlugin } from './default-plugin';

// ── 注册语言插件 ──
import { registerCodePlugin } from './registry';
import { mermaidPlugin } from './mermaid-plugin';
import { htmlPlugin } from './html-plugin';
import { markdownPlugin } from './markdown-plugin';
import { jsPlugin } from './js-plugin';

registerCodePlugin(mermaidPlugin);
registerCodePlugin(htmlPlugin);
registerCodePlugin(markdownPlugin);
registerCodePlugin(jsPlugin);

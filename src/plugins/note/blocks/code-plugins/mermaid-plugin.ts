import type { CodeLanguagePlugin, CodePluginContext } from './types';
import { openMermaidFullscreen } from './mermaid-fullscreen';
// showMermaidPanel/hideMermaidPanel 由 code-block.ts 管理（需要 insertFn 回调）

/**
 * Mermaid Code Plugin — 图表渲染、全屏编辑、下载 PNG/SVG
 *
 * 从 code-block.ts 迁移的 Mermaid 专属逻辑：
 * - 初始化（mermaid + ELK layout）
 * - 渲染（renderPreview）
 * - 主题/模板常量
 */

// ═══════════════════════════════════════════════════════
// Mermaid 初始化
// ═══════════════════════════════════════════════════════

let mermaidInitialized = false;
let mermaidModule: any = null;
let mermaidIdCounter = 0;

function buildMermaidConfig(theme: string = 'dark') {
  return {
    startOnLoad: false,
    theme,
    darkMode: theme === 'dark',
    securityLevel: 'loose',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 16,
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'monotoneY',
      diagramPadding: 16,
      nodeSpacing: 50,
      rankSpacing: 60,
      padding: 15,
      wrappingWidth: 400,
      defaultRenderer: 'elk',
    },
  };
}

async function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaidModule = (await import('mermaid')).default;

  try {
    const elkLayouts = (await import('@mermaid-js/layout-elk')).default;
    mermaidModule.registerLayoutLoaders(elkLayouts);
  } catch (e) {
    console.warn('[Mermaid] ELK layout not available, using dagre:', e);
  }

  mermaidModule.initialize(buildMermaidConfig('dark'));
}

// ═══════════════════════════════════════════════════════
// 主题 + 模板
// ═══════════════════════════════════════════════════════

export const MERMAID_THEMES = ['dark', 'default', 'forest', 'neutral', 'base'] as const;
export type MermaidTheme = typeof MERMAID_THEMES[number];

export const MERMAID_TEMPLATES: { label: string; code: string }[] = [
  { label: 'Flowchart', code: 'graph TD\n  A[开始] --> B{条件}\n  B -->|是| C[操作]\n  B -->|否| D[跳过]\n  C --> E[结束]\n  D --> E' },
  { label: 'Sequence', code: 'sequenceDiagram\n  participant A as 用户\n  participant B as 服务器\n  A->>B: 请求\n  B-->>A: 响应' },
  { label: 'Class', code: 'classDiagram\n  class Animal {\n    +String name\n    +move()\n  }\n  class Dog {\n    +bark()\n  }\n  Animal <|-- Dog' },
  { label: 'State', code: 'stateDiagram-v2\n  [*] --> Idle\n  Idle --> Processing : start\n  Processing --> Done : finish\n  Done --> [*]' },
  { label: 'ER', code: 'erDiagram\n  USER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains\n  USER {\n    int id\n    string name\n  }' },
  { label: 'Gantt', code: 'gantt\n  title 项目计划\n  dateFormat YYYY-MM-DD\n  section 阶段一\n  任务A :a1, 2024-01-01, 7d\n  任务B :after a1, 5d\n  section 阶段二\n  任务C :2024-01-15, 10d' },
  { label: 'Pie', code: 'pie title 分布\n  "A" : 40\n  "B" : 30\n  "C" : 20\n  "D" : 10' },
  { label: 'Mindmap', code: 'mindmap\n  root((主题))\n    分支A\n      叶子1\n      叶子2\n    分支B\n      叶子3' },
];

// ═══════════════════════════════════════════════════════
// 渲染函数（供 code-block.ts 调用）
// ═══════════════════════════════════════════════════════

/** 渲染 Mermaid 图表到容器 */
export async function renderMermaidDiagram(source: string, container: HTMLElement): Promise<void> {
  const trimmed = source.replace(/[\u200B\u200C\u200D\uFEFF]/g, '').trim();
  if (!trimmed) {
    container.style.display = 'flex';
    container.innerHTML = '<div class="code-block__mermaid-empty">输入 Mermaid 语法查看预览</div>';
    return;
  }

  await ensureMermaidInit();
  const renderId = `mermaid-${++mermaidIdCounter}`;
  try {
    const { svg } = await mermaidModule.render(renderId, trimmed);
    container.style.display = 'flex';
    container.innerHTML = svg;
  } catch {
    container.style.display = 'flex';
    container.innerHTML = '<div class="code-block__mermaid-error">Mermaid 语法错误</div>';
    document.getElementById('d' + renderId)?.remove();
  }
}

/** 获取 mermaid 模块（供全屏编辑器重新配置主题用） */
export async function getMermaidModule(): Promise<any> {
  await ensureMermaidInit();
  return mermaidModule;
}

export { buildMermaidConfig };

// ═══════════════════════════════════════════════════════
// Plugin 接口实现
// ═══════════════════════════════════════════════════════

export const mermaidPlugin: CodeLanguagePlugin = {
  languages: ['mermaid'],
  hasPreview: true,

  renderPreview(code: string, container: HTMLElement) {
    renderMermaidDiagram(code, container);
  },

  schedulePreview(code: string, container: HTMLElement) {
    // Mermaid 使用 code-block.ts 核心的 scheduleRender（防抖 500ms）
    // 这里不自行防抖，交给核心的 MutationObserver 调度
    renderMermaidDiagram(code, container);
  },

  activate(ctx: CodePluginContext) {
    ctx.previewElement.style.display = 'flex';
    renderMermaidDiagram(ctx.getCode(), ctx.previewElement);
  },

  deactivate(ctx: CodePluginContext) {
    ctx.previewElement.style.display = 'none';
  },

  openFullscreen(ctx: CodePluginContext) {
    openMermaidFullscreen(ctx);
  },
};

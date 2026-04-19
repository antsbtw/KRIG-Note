/**
 * Claude 暗色主题 CSS 变量定义
 *
 * Claude 页面中 AI 生成的 SVG / HTML artifact 使用这些 CSS 变量。
 * 在 Note 中渲染时，需要注入这些变量定义才能正确还原视觉效果。
 *
 * SVG：注入到容器元素的 style 属性上（DOM 继承）
 * HTML iframe：注入到 srcdoc 的 <style>:root{...}</style> 中
 */

/** CSS 变量键值对 */
export const CLAUDE_THEME_VARS: Record<string, string> = {
  // ── 文字颜色 ──
  '--color-text-primary': '#e8e8e8',
  '--color-text-secondary': '#a3a3a3',
  '--color-text-tertiary': '#737373',
  '--text-color-primary': '#e8e8e8',
  '--text-color-secondary': '#a3a3a3',
  '--text-color-tertiary': '#737373',
  '--fg-color': '#e8e8e8',

  // ── 背景颜色 ──
  '--color-bg-primary': '#1e1e1e',
  '--color-bg-secondary': '#2a2a2a',
  '--color-bg-tertiary': '#3a3a3a',
  '--color-background-primary': '#1e1e1e',
  '--color-background-secondary': '#2a2a2a',
  '--color-background-tertiary': '#3a3a3a',
  '--bg-color': '#1e1e1e',

  // ── 边框颜色 ──
  '--color-border-primary': '#5a5a5a',
  '--color-border-secondary': '#4a4a4a',
  '--color-border-tertiary': '#3a3a3a',

  // ── 语义颜色：信息 ──
  '--color-text-info': '#78c8f0',
  '--color-background-info': 'rgba(120, 200, 240, 0.12)',
  '--color-border-info': 'rgba(120, 200, 240, 0.25)',

  // ── 语义颜色：警告 ──
  '--color-text-warning': '#e8a820',
  '--color-background-warning': 'rgba(232, 168, 32, 0.12)',
  '--color-border-warning': 'rgba(232, 168, 32, 0.25)',

  // ── 语义颜色：成功 ──
  '--color-text-success': '#4ade80',
  '--color-background-success': 'rgba(74, 222, 128, 0.12)',
  '--color-border-success': 'rgba(74, 222, 128, 0.25)',

  // ── 语义颜色：错误 ──
  '--color-text-danger': '#f87171',
  '--color-background-danger': 'rgba(248, 113, 113, 0.12)',
  '--color-border-danger': 'rgba(248, 113, 113, 0.25)',

  // ── 圆角 ──
  '--border-radius-sm': '4px',
  '--border-radius-md': '8px',
  '--border-radius-lg': '12px',
  '--border-radius-xl': '16px',
};

/**
 * 生成内联 style 属性值（用于 SVG 容器注入）
 * 例: "--color-text-primary: #e8e8e8; --color-bg-primary: #1e1e1e; ..."
 */
export function claudeThemeInlineStyle(): string {
  return Object.entries(CLAUDE_THEME_VARS)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

/**
 * 生成 <style> 块（用于 HTML iframe srcdoc 注入）
 * 例: "<style>:root { --color-text-primary: #e8e8e8; ... }</style>"
 */
export function claudeThemeStyleTag(): string {
  const vars = Object.entries(CLAUDE_THEME_VARS)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  return `<style>:root {\n${vars}\n}</style>`;
}

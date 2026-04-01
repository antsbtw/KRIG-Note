/**
 * 应用配置 — 集中管理所有可配置项
 *
 * 应用名、图标路径、默认值等不散落在代码中，
 * 统一从这里读取，未来改动只改这一个文件。
 */

export const APP_CONFIG = {
  // ── 应用身份 ──
  name: 'KRIG Note',
  shortName: 'KRIG',

  // ── 图标路径（相对于项目根目录） ──
  icon: {
    icns: 'build/icon.icns',     // macOS
    ico: 'build/icon.ico',       // Windows（待生成）
    png: 'build/logo.png',       // 通用
    logo: 'public/logo.jpg',     // NavSide Brand Bar
  },

  // ── 窗口默认值 ──
  window: {
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
  },

  // ── 布局默认值 ──
  layout: {
    navSideWidth: 240,
    topBarHeight: 36,
    toggleWidth: 40,
    dividerWidth: 6,
  },

  // ── Workspace 默认值 ──
  workspace: {
    defaultWorkModeId: '',       // 空字符串 = 使用 WorkMode 注册表中 order 最小的
    defaultDividerRatio: 0.5,
    dividerRatioMin: 0.2,
    dividerRatioMax: 0.8,
  },
} as const;

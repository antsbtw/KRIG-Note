import type { ComponentType } from 'react';

/**
 * NavSide 面板注册表
 *
 * 插件注册自己的面板组件，NavSide 根据 contentType 动态渲染。
 * 框架层不再直接 import 任何插件面板。
 *
 * ─── NavSide 契约：切换 = 干净单屏 ─────────────────────────────
 * 所有从 NavSide 触发的"打开主内容"操作（点笔记/点书/点书签/
 * WorkMode 切换）都要**先** `navSideAPI.closeRightSlot()`，再
 * 执行 open 动作。这是 NavSide 的 UX 约定：每次切换让用户看到
 * 清爽的单栏视图，需要副面板时再手动打开。
 *
 * 新增面板时请遵守此契约 —— 在你的 handleOpen/handleClick 首行
 * 调 `navSideAPI.closeRightSlot()`。
 * ─────────────────────────────────────────────────────────────
 */

/** 面板组件通用 props */
export interface NavPanelProps {
  activeBookId: string | null;
  initialExpandedFolders?: string[];
  onActiveBookChange: (id: string | null) => void;
  dbReady: boolean;
}

const registry = new Map<string, ComponentType<Partial<NavPanelProps>>>();

/** 注册一个 NavSide 面板组件 */
export function registerNavPanel(contentType: string, component: ComponentType<any>): void {
  registry.set(contentType, component);
}

/** 获取指定 contentType 的面板组件 */
export function getNavPanel(contentType: string): ComponentType<Partial<NavPanelProps>> | undefined {
  return registry.get(contentType);
}

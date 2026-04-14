import type { ComponentType } from 'react';

/**
 * NavSide 面板注册表
 *
 * 插件注册自己的面板组件，NavSide 根据 contentType 动态渲染。
 * 框架层不再直接 import 任何插件面板。
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

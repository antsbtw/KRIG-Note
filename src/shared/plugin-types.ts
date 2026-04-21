/**
 * Plugin Registration Interface
 *
 * 每个插件暴露一个 register() 函数，在 app.ts 启动时调用。
 * 插件通过框架提供的注册表（WorkMode、Menu、NavSide、Protocol）注册自己的能力。
 * 框架不知道具体有哪些插件——只知道注册表里有什么。
 */

export interface PluginContext {
  /** 获取主窗口（用于 dialog 等场景） */
  getMainWindow: () => import('electron').BaseWindow | null;
}

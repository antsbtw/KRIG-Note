/**
 * Thought 通信协议 — Action 常量定义
 *
 * Note ↔ Thought 的所有交互通过 ViewMessage 双工通道，
 * 框架只路由，不解析 payload。
 */

export const THOUGHT_PROTOCOL = 'note-thought';

// ── Note → Thought (Left → Right) ──

export const THOUGHT_ACTION = {
  /** Note 创建了新 Thought，通知 Thought 面板新增卡片 */
  CREATE: 'thought:create',
  /** 点击锚点，Thought 面板展开对应卡片 */
  ACTIVATE: 'thought:activate',
  /** Note 滚动时发送可见锚点 ID 列表 */
  SCROLL_SYNC: 'thought:scroll-sync',
  /** Note 加载新文档，Thought 加载对应 thoughts */
  NOTE_LOADED: 'thought:note-loaded',

  // ── Thought → Note (Right → Left) ──

  /** 点击锚点预览，Note 滚动到锚点位置并闪烁 */
  SCROLL_TO_ANCHOR: 'thought:scroll-to-anchor',
  /** 删除 Thought，Note 移除对应 mark/attr */
  DELETE: 'thought:delete',
  /** 类型变更，Note 更新锚点样式 */
  TYPE_CHANGE: 'thought:type-change',
} as const;

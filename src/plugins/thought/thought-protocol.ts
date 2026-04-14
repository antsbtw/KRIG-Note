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

  // ── AI Workflow（扩展）──

  /** Note → main（via IPC）: 请求 AI 回答 — 不走 ViewMessage，走 IPC ai:ask */
  // AI_ASK 不在此定义，因为它走 IPC 通道而非 ViewMessage

  /** main → ThoughtView: AI 回复就绪，填充 ThoughtCard 内容 */
  AI_RESPONSE_READY: 'thought:ai-response-ready',
  /** main → Note + ThoughtView: AI 回复失败 */
  AI_ERROR: 'thought:ai-error',
  /** ThoughtView → main（via IPC）: 追问（基于某条 AI 回复继续提问） */
  // AI_FOLLOWUP 不在此定义，走 IPC ai:ask
} as const;

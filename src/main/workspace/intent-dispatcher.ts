import type { IntentEvent } from '@shared/intents';

/**
 * IntentDispatcher — L3 层意图调度中心
 *
 * 视图通过 dispatch(IntentEvent) 上抛意图,本类决定布局响应。
 * 取代视图直接调 openCompanion / closeRightSlot 等特权 API 的旧路径。
 *
 * 详见总纲 § 1.1 分层原则 + § 5 View-scoped Registry。
 *
 * v1 仅骨架,具体布局决策逻辑由波次 3 各插件迁移时驱动。
 */
export class IntentDispatcher {
  /**
   * 接收意图事件,决定布局响应。
   * v1 仅日志,实际布局调度由后续阶段实现。
   */
  dispatch(event: IntentEvent): void {
    // eslint-disable-next-line no-console
    console.log('[IntentDispatcher] received intent:', event.type, event);
  }
}

/** 全局单例——平台层共用一个 dispatcher */
export const intentDispatcher = new IntentDispatcher();

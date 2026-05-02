/**
 * Intent 事件契约：L5 视图通过 dispatch(IntentEvent) 上抛意图，
 * 由 L3 IntentDispatcher 决定布局响应。视图禁止直接调 openCompanion 等特权 API。
 */

export type IntentEvent =
  | ContentOpenedIntent
  | AiAssistanceRequestedIntent
  | SplitScreenRequestedIntent
  | LayoutModeChangeRequestedIntent;

export interface ContentOpenedIntent {
  type: 'content:opened';
  payload: { viewId: string; resourceId: string };
}

export interface AiAssistanceRequestedIntent {
  type: 'intent:ai-assistance-requested';
  payload: { context?: unknown };
}

export interface SplitScreenRequestedIntent {
  type: 'intent:split-screen-requested';
  payload: { viewId: string };
}

export interface LayoutModeChangeRequestedIntent {
  type: 'intent:layout-mode-change-requested';
  payload: { mode: string };
}

/**
 * NavSide ActiveState 订阅 hook（v1.4 NavSide 重构）。
 *
 * 用法：
 *   const activeNoteId = useActiveState(s => s.activeNoteId);
 *   const expandedFolders = useActiveState(s => s.expandedFolders);
 *
 * 仅当 selector 输出变化时（按 Object.is 比较）才触发该 hook 所在组件 rerender。
 *
 * 内部用 React 18 的 useSyncExternalStore 实现，与 React 并发模式兼容。
 */
import { useSyncExternalStore, useRef } from 'react';
import { activeStateStore, type NavSideActiveState } from './active-state-store';

export function useActiveState<T>(selector: (state: NavSideActiveState) => T): T {
  // 缓存 selector 上次返回值，避免相同输入产生新引用导致 useSyncExternalStore 抖动
  const lastRef = useRef<{ deps: NavSideActiveState; result: T } | null>(null);

  const getSlice = (): T => {
    const state = activeStateStore.getSnapshot();
    if (lastRef.current && lastRef.current.deps === state) {
      return lastRef.current.result;
    }
    const result = selector(state);
    lastRef.current = { deps: state, result };
    return result;
  };

  return useSyncExternalStore(activeStateStore.subscribe, getSlice, getSlice);
}

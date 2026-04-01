import { Plugin } from 'prosemirror-state';

/**
 * toggleHeading Plugin — 键盘交互
 *
 * 处理折叠/展开快捷键等特殊交互。
 * Enter 行为由 enterHandlerPlugin 统一处理（enterBehavior 声明式）。
 */

export function toggleHeadingPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        // 未来：Cmd+Delete 折叠/展开等快捷键
        return false;
      },
    },
  });
}

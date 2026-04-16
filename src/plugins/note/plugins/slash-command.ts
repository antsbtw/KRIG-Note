import { Plugin, PluginKey } from 'prosemirror-state';

/**
 * Slash Command Plugin — 监听 / 输入，触发 SlashMenu
 *
 * 在行首或空行输入 / 时打开菜单。
 * 后续输入过滤候选项。
 * Enter 确认 / Escape 关闭。
 */

export interface SlashCommandState {
  active: boolean;
  query: string;
  from: number;  // / 字符的位置
  to: number;    // 当前输入末尾位置
}

const INITIAL: SlashCommandState = { active: false, query: '', from: 0, to: 0 };

export const slashCommandKey = new PluginKey<SlashCommandState>('slashCommand');

export function slashCommandPlugin(): Plugin {
  return new Plugin({
    key: slashCommandKey,

    state: {
      init(): SlashCommandState { return INITIAL; },
      apply(tr, prev): SlashCommandState {
        const meta = tr.getMeta(slashCommandKey);
        if (meta?.close) return INITIAL;
        if (meta?.open) return { active: true, query: '', from: meta.from, to: meta.to };

        // 文档没变 → 沿用旧状态（含选区移动等）
        if (!tr.docChanged) return prev;

        // 仅在 textBlock 内激活 / 维护菜单
        const $from = tr.doc.resolve(tr.selection.from);
        if ($from.parent.type.name !== 'textBlock') {
          return prev.active ? INITIAL : prev;
        }

        const blockStart = $from.start();
        const textBefore = $from.parent.textBetween(0, $from.parentOffset);

        if (prev.active) {
          // 维护期：以原 / 位置为锚点重算 query；/ 被删则关闭
          const slashOffset = prev.from - blockStart;
          if (slashOffset < 0 || textBefore[slashOffset] !== '/') return INITIAL;
          const query = textBefore.slice(slashOffset + 1);
          return { active: true, query, from: prev.from, to: tr.selection.from };
        }

        // 激活检测：扫描光标前文本里最近的"合法 /"——必须在行首或紧跟空白，
        // 避开 "1/2"、"a/b" 这类行内表达式。这种"扫描后向"写法对 IME 友好：
        // 整段 "/2c" 在 compositionend 时一次性写入文档，textBefore 不以 /
        // 结尾，但仍能找到行首的 /。
        const slashPosInBlock = findActivatableSlash(textBefore);
        if (slashPosInBlock < 0) return prev;

        const query = textBefore.slice(slashPosInBlock + 1);
        return {
          active: true,
          query,
          from: blockStart + slashPosInBlock,
          to: tr.selection.from,
        };
      },
    },

    props: {
      handleKeyDown(view, event) {
        const state = slashCommandKey.getState(view.state);
        if (!state?.active) return false;

        // 关闭菜单
        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(slashCommandKey, { close: true }));
          return true;
        }

        // Enter / ArrowUp / ArrowDown 由 SlashMenu 组件处理，阻止 ProseMirror 默认行为
        if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          return true;
        }

        return false;
      },
    },
  });
}

/**
 * 在光标前文本中找最近的「可激活的 /」位置：
 *   - 必须在行首，或前一个字符是空白
 *   - 后跟的 query 段不能含空白（用户敲了空格说明想结束输入命令）
 *
 * 返回 / 在 textBefore 中的偏移；找不到返回 -1。
 *
 * 这种「向后扫描」写法对 IME 友好：composing 期间 PM 不派 transaction，
 * 整段 "/2c" 在 compositionend 时一次性入文档，光看 textBefore 末尾找不到 /，
 * 但仍能识别行首的 /。
 */
function findActivatableSlash(textBefore: string): number {
  for (let i = textBefore.length - 1; i >= 0; i--) {
    const ch = textBefore[i];
    if (ch === '/') {
      const charBefore = i > 0 ? textBefore[i - 1] : '';
      if (i === 0 || /\s/.test(charBefore)) return i;
      return -1; // 找到的 / 不合法（行内表达式），不继续往前找
    }
    if (/\s/.test(ch)) return -1; // query 段里有空白 → 用户已结束命令输入
  }
  return -1;
}

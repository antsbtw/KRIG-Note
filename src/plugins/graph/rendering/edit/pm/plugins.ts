import { keymap } from 'prosemirror-keymap';
import { history, undo, redo } from 'prosemirror-history';
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  chainCommands,
  exitCode,
} from 'prosemirror-commands';
import {
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
import type { Plugin } from 'prosemirror-state';
import { graphSchema } from './schema';
import { buildSlashMenuPlugin } from './slash-menu';

/**
 * 通用 PM 插件集合（v1.3 § 4.3 mark 优先级）。
 *
 * keymap:
 * - Cmd-B / Ctrl-B: bold
 * - Cmd-I / Ctrl-I: italic
 * - Cmd-U / Ctrl-U: underline
 * - Cmd-E / Ctrl-E: code
 * - Cmd-Z / Ctrl-Z: undo
 * - Cmd-Shift-Z / Ctrl-Shift-Z: redo
 * - Cmd-Alt-1/2/3: h1/h2/h3
 * - Cmd-Alt-0: paragraph
 * - Tab / Shift-Tab: 列表内缩进 / 反缩进
 * - Enter: 列表内拆分项；普通段落进新段落（baseKeymap 默认）
 * - Shift-Enter: 段内换行（hardBreak）
 *
 * inputrules:
 * - "# " → h1，"## " → h2，"### " → h3
 * - "- " / "* " → bulletList
 * - "1. " → orderedList
 *
 * 注：Esc / 提交快捷键由 EditOverlay 监听 keydown 处理（在 PM 之上一层），
 * 不在 PM keymap 内（因为提交是浮层级别行为，不属于编辑器内部）。
 */
export function buildGraphPmPlugins(): Plugin[] {
  const s = graphSchema;
  const { textBlock, bulletList, orderedList, listItem, hardBreak } = s.nodes;

  return [
    history(),

    // Slash menu 必须在 keymap 之前：handleKeyDown 优先级靠前，这样
    // 菜单激活时 ↑↓ Enter Esc 不会被 keymap 提前消费
    buildSlashMenuPlugin(),

    inputRules({
      rules: [
        // # h1, ## h2, ### h3
        textblockTypeInputRule(/^#\s$/, textBlock, { level: 1 }),
        textblockTypeInputRule(/^##\s$/, textBlock, { level: 2 }),
        textblockTypeInputRule(/^###\s$/, textBlock, { level: 3 }),
        // - / * → bulletList
        wrappingInputRule(/^\s*([-+*])\s$/, bulletList),
        // 1. → orderedList
        wrappingInputRule(/^(\d+)\.\s$/, orderedList),
      ],
    }),

    keymap({
      // Mark 快捷键
      'Mod-b': toggleMark(s.marks.bold),
      'Mod-i': toggleMark(s.marks.italic),
      'Mod-u': toggleMark(s.marks.underline),
      'Mod-e': toggleMark(s.marks.code),

      // History
      'Mod-z': undo,
      'Mod-Shift-z': redo,
      'Mod-y': redo,

      // Heading 快捷键
      'Mod-Alt-0': setBlockType(textBlock, { level: null }),
      'Mod-Alt-1': setBlockType(textBlock, { level: 1 }),
      'Mod-Alt-2': setBlockType(textBlock, { level: 2 }),
      'Mod-Alt-3': setBlockType(textBlock, { level: 3 }),

      // 列表项缩进
      Tab: sinkListItem(listItem),
      'Shift-Tab': liftListItem(listItem),

      // Enter: 列表内拆分；其他情况走 baseKeymap
      Enter: chainCommands(
        splitListItem(listItem),
        // 退到 baseKeymap.Enter（split block）
      ),

      // Shift-Enter: 段内换行（hardBreak）
      'Shift-Enter': chainCommands(exitCode, (state, dispatch) => {
        if (dispatch) {
          dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
        }
        return true;
      }),
    }),

    keymap(baseKeymap),
  ];
}

/**
 * smart-paste-plugin — clipboard → KRIG blocks dispatcher.
 *
 * ─────────────────────────────────────────────────────────────
 * Shortcut conventions
 * ─────────────────────────────────────────────────────────────
 *
 *   Cmd+V (default)    → "paste as markdown": dispatcher picks a
 *                        source handler, gets back a Markdown string,
 *                        feeds it through md-to-pm. AI assistants,
 *                        Word tables, and generic rich HTML all land
 *                        as proper blocks.
 *
 *   Cmd+Shift+V        → "paste as plain text": every character goes
 *                        in verbatim, \n becomes hardBreak, blank
 *                        lines become paragraph splits. No Markdown
 *                        interpretation, no handler dispatch. Escape
 *                        hatch for when markdown interpretation would
 *                        misread the content (raw text logs, poetry,
 *                        anything where `$` / `#` / `-` characters
 *                        are meaningful but not markdown).
 *
 * ─────────────────────────────────────────────────────────────
 * Dispatcher contract
 * ─────────────────────────────────────────────────────────────
 *
 * Each `PasteHandler` inspects the clipboard and may claim ownership
 * via `detect()`. The first handler to claim is called; if its
 * `toMarkdown()` returns an empty string the dispatcher treats that
 * as a soft skip and tries the next handler. `genericHandler` is the
 * always-match catch-all at the end, so the dispatcher never falls
 * off the end of the list.
 *
 * Source-specific handlers (Word, Notion, Excel, Wiki, …) live in
 * `sources/*.ts`. Add new ones by importing and unshifting to the
 * `HANDLERS` list so they're tried before the generic fallback.
 * See `docs/note/Paste-Module-Design.md` for the roadmap and
 * per-source design notes.
 *
 * ─────────────────────────────────────────────────────────────
 * Interaction with paste-media
 * ─────────────────────────────────────────────────────────────
 *
 * paste-media (in src/plugins/note/plugins/) runs before this plugin
 * and handles clipboard image bytes. When the clipboard has BOTH an
 * image and structural HTML (Word/Excel bundle a PNG render as a
 * fallback), paste-media defers to this dispatcher so the real table
 * wins. Pure screenshots (image only) keep inserting as image blocks.
 */

import { Plugin, NodeSelection } from 'prosemirror-state';
import { Slice, Fragment } from 'prosemirror-model';
import type { PasteClipboard, PasteHandler } from './types';
import { genericHandler } from './sources/generic';
import {
  computeSliceForClipboard,
  writeKrigDataToTransfer,
  readKrigDataFromTransfer,
} from './internal-clipboard';
import { blockSelectionKey } from '../plugins/block-selection';
import { deleteSelection as deleteSelectionCmd, deleteBlocks } from '../commands/editor-commands';

/** RenderBlock 节点：用户点击图片/视频时被 NodeSelection 选中。 */
const RENDER_BLOCK_TYPES = new Set(['image', 'audioBlock', 'videoBlock', 'tweetBlock', 'fileBlock', 'externalRef']);

/**
 * 粘贴安全守卫：检查 tr 执行后，光标所在位置的祖先节点链是否被破坏。
 *
 * 原则：粘贴只在光标位置插入内容，绝不删除光标之外的节点。
 * 方法：比较 tr 前后文档，光标处每一层祖先节点是否仍然存在且类型不变。
 */
function pasteIsSafe(state: import('prosemirror-state').EditorState, tr: import('prosemirror-state').Transaction): boolean {
  const $from = state.selection.$from;

  // 记录粘贴前光标的每层祖先节点类型
  const ancestorTypes: string[] = [];
  for (let d = 1; d <= $from.depth; d++) {
    ancestorTypes.push($from.node(d).type.name);
  }

  // 用 step map 把原始位置映射到 tr 执行后的位置
  const mappedPos = tr.mapping.map($from.pos);
  try {
    const $mapped = tr.doc.resolve(mappedPos);
    // 如果 depth 减小了，说明有祖先节点被删除
    if ($mapped.depth < $from.depth) return false;
    // 检查每层祖先类型是否一致
    for (let d = 1; d <= ancestorTypes.length; d++) {
      if (d > $mapped.depth) return false;
      if ($mapped.node(d).type.name !== ancestorTypes[d - 1]) return false;
    }
  } catch {
    // resolve 失败说明位置无效，文档结构被破坏
    return false;
  }
  return true;
}

/**
 * 计算粘贴 slice 的开放深度。
 *
 * openStart=openEnd=0 表示"完整密封的 block 序列"——PM 找不到合适层级时会破坏性提升插入位置；
 * 在 caption 这种 content='textBlock' 的容器里粘贴段落 slice 时会导致整个父节点被替换。
 *
 * 用 Slice.maxOpen 让 PM 自动算出最大开放深度：单段 textBlock → 1（首尾的 textBlock 节点
 * 都是开放的，文字溶解到目标文本块）；多段 → 首尾各 1，中间段保持完整。
 */
function buildPasteSlice(fragment: Fragment): Slice {
  return Slice.maxOpen(fragment);
}

/** Registered handlers, in priority order. Specific → generic. */
const HANDLERS: PasteHandler[] = [
  // Future: wordHandler, notionHandler, excelHandler, wikiHandler, …
  genericHandler,
];

interface ViewAPILike {
  markdownToPMNodes?: (markdown: string) => Promise<unknown[]>;
}

// Global shift tracker — ClipboardEvent doesn't carry modifier keys.
let shiftDown = false;
let trackerInstalled = false;
function installShiftTracker() {
  if (trackerInstalled) return;
  trackerInstalled = true;
  window.addEventListener('keydown', (e) => { if (e.key === 'Shift') shiftDown = true; });
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shiftDown = false; });
  window.addEventListener('blur', () => { shiftDown = false; });
}

export function smartPastePlugin(): Plugin {
  installShiftTracker();
  return new Plugin({
    props: {
      // 复制 / 剪切 时把 Slice 序列化为 PM JSON，嵌入到 text/html 末尾的注释里。
      // 自定义 application/* MIME 在 macOS/Electron 系统剪贴板会被剥掉，
      // text/html 是标准类型不会丢；外部应用读 HTML 时把注释当无害字符忽略。
      handleDOMEvents: {
        copy(view, event) {
          attachInternalClipboard(view, event as ClipboardEvent);
          return false;
        },
        cut(view, event) {
          attachInternalClipboard(view, event as ClipboardEvent);
          // attachInternalClipboard 已 preventDefault，需手动删除内容
          deleteSelectionCmd(view);
          return true;
        },
      },

      handlePaste(view, event) {
        const cd = event.clipboardData;
        if (!cd) return false;

        // ── 内部通道优先：text/html 里有 KRIG JSON 注释就走无损还原路径 ──
        // 跨应用粘贴的 HTML 里没有这个 marker，自然落到下面的外部管道。
        // Shift 强制纯文本粘贴时跳过，遵从用户显式意图。
        if (!shiftDown) {
          const slice = readKrigDataFromTransfer(cd, view.state.schema);
          if (slice) {
            const tr = view.state.tr.replaceSelection(slice).scrollIntoView();
            if (pasteIsSafe(view.state, tr)) {
              view.dispatch(tr);
            } else {
              // slice 会破坏容器结构（如 caption 内粘贴），降级为纯文本插入
              const text = slice.content.textBetween(0, slice.content.size, '\n\n');
              if (text) {
                view.dispatch(view.state.tr.insertText(text).scrollIntoView());
              }
            }
            return true;
          }
        }

        const clipboard: PasteClipboard = {
          plain: cd.getData('text/plain') || '',
          html: cd.getData('text/html') || '',
          hasImage: Array.from(cd.items).some(it => it.kind === 'file' && it.type.startsWith('image/')),
        };
        // Let paste-media handle pure-image payloads. (Word/Excel sends
        // a PNG alongside HTML; paste-media itself already defers to
        // us in that case — see paste-media.ts.)
        if (clipboard.hasImage && !clipboard.html && !clipboard.plain) return false;

        // Shift branch: straight plain text insert, no handlers.
        if (shiftDown) {
          if (!clipboard.plain.trim()) return false;
          insertAsPlainText(view, clipboard.plain);
          return true;
        }

        // Dispatcher: try each handler in priority order.
        let markdown = '';
        for (const h of HANDLERS) {
          if (!h.detect(clipboard)) continue;
          const r = h.toMarkdown(clipboard);
          if (r.markdown) { markdown = r.markdown; break; }
        }
        if (!markdown.trim()) return false;

        const api: ViewAPILike | undefined = (window as any).viewAPI;
        if (!api?.markdownToPMNodes) return false;

        // 同步阶段捕获 selection 快照：异步回调里 selection 可能已被 PM/浏览器
        // 漂移（NodeSelection → 进入 caption 的 TextSelection），回调里再读就晚了。
        const initialSel = view.state.selection;

        api.markdownToPMNodes(markdown).then(nodes => {
          if (!Array.isArray(nodes) || nodes.length === 0) return;
          try {
            const { state } = view;
            const { schema } = state;
            const pmNodes = nodes
              .map(n => {
                try { return schema.nodeFromJSON(n as any); }
                catch { return null; }
              })
              .filter((n): n is NonNullable<typeof n> => !!n);
            if (pmNodes.length === 0) return;

            const fragment = Fragment.from(pmNodes);

            // 用户按 Cmd+V 那一刻整个 RenderBlock 处于 NodeSelection —— 没有真实
            // 文本光标，把内容插到节点之后；这是「整块被选中」语义的自然延伸。
            let tr;
            if (initialSel instanceof NodeSelection && RENDER_BLOCK_TYPES.has(initialSel.node.type.name)) {
              tr = state.tr.insert(initialSel.from + initialSel.node.nodeSize, pmNodes).scrollIntoView();
            } else {
              // 否则一律走 replaceSelection——光标在哪粘哪。用 maxOpen 让首尾段落
              // 的文字溶解到光标所在文本块，避免 closed slice 被 PM 提升到外层
              // 容器、导致父节点（如 image）被破坏性替换。
              tr = state.tr.replaceSelection(buildPasteSlice(fragment)).scrollIntoView();
            }
            if (pasteIsSafe(state, tr)) {
              view.dispatch(tr);
            } else {
              // block slice 会破坏容器结构（如 caption），降级为纯文本插入
              const text = fragment.textBetween(0, fragment.size, '\n\n');
              if (text) {
                view.dispatch(state.tr.insertText(text).scrollIntoView());
              }
            }
          } catch (err) {
            console.warn('[smart-paste] PM insert failed:', err);
          }
        }).catch(err => {
          console.warn('[smart-paste] markdownToPMNodes failed:', err);
        });

        return true;
      },
    },
  });
}

/**
 * Plain-text paste (Cmd+Shift+V branch).
 *
 * Splits on blank lines into paragraph-per-chunk; single `\n` becomes
 * a `hardBreak` inside the current paragraph. No marks, no link
 * parsing, no markdown interpretation.
 */
function insertAsPlainText(view: any, text: string) {
  const { state } = view;
  const { schema } = state;
  const paragraphType = schema.nodes.textBlock || schema.nodes.paragraph;
  if (!paragraphType) {
    view.dispatch(state.tr.insertText(text, state.selection.from, state.selection.to));
    return;
  }

  const paragraphs = text.split(/\n{2,}/);
  const nodes: any[] = [];
  for (const para of paragraphs) {
    const lines = para.split('\n');
    const parts: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) parts.push(schema.text(lines[i]));
      if (i < lines.length - 1 && schema.nodes.hardBreak) {
        parts.push(schema.nodes.hardBreak.create());
      }
    }
    try {
      nodes.push(paragraphType.create(null, parts));
    } catch {
      nodes.push(paragraphType.create(null, schema.text(para.replace(/\n/g, ' '))));
    }
  }
  if (nodes.length === 0) return;

  const fragment = Fragment.from(nodes);

  // 与 markdown 路径同样的 selection 处理：NodeSelection on RenderBlock 时
  // insert-after；其他情况一律 replaceSelection（光标在哪粘哪），用 maxOpen
  // 让首尾段落溶解到目标文本块。
  const sel = state.selection;
  let tr;
  if (sel instanceof NodeSelection && RENDER_BLOCK_TYPES.has(sel.node.type.name)) {
    tr = state.tr.insert(sel.from + sel.node.nodeSize, nodes).scrollIntoView();
  } else {
    tr = state.tr.replaceSelection(buildPasteSlice(fragment)).scrollIntoView();
  }
  if (pasteIsSafe(state, tr)) {
    view.dispatch(tr);
  } else {
    // block nodes 会破坏容器结构（如 caption），降级为 insertText
    view.dispatch(state.tr.insertText(text).scrollIntoView());
  }
}

/**
 * copy / cut 时把 selection 转成 Slice 写入剪贴板的 INTERNAL_CLIPBOARD_MIME 字段。
 *
 * 不阻止 PM 的默认 copy 行为——PM 仍然会写 text/html 和 text/plain（给跨应用用）。
 * 我们只是叠加一个独立 MIME 字段，站内粘贴时优先读它无损还原。
 *
 * 两种 selection 来源：
 *   1. block-selection plugin 激活时：用 selectedPositions 的最小 → 最大范围，
 *      doc.slice(from, to, true) 自然包含所有外层容器
 *   2. 普通 PM Selection（TextSelection / NodeSelection）：用 selection.content()，
 *      底层同样调 doc.slice(from, to, true)
 *
 * 两种路径最终都通过 doc.slice 拿到完整 Slice，无需任何节点白名单——schema 里
 * 有什么节点都自动支持。
 */
function attachInternalClipboard(view: any, event: ClipboardEvent) {
  if (!event.clipboardData) return;
  try {
    const slice = computeSliceForClipboard(view.state);
    if (!slice || slice.size === 0) return;
    // 调 setData 之前必须 preventDefault，否则浏览器会用自己的默认数据覆盖。
    event.preventDefault();
    writeKrigDataToTransfer(event.clipboardData, slice, view.state.schema);
  } catch (err) {
    console.warn('[smart-paste] internal clipboard write failed:', err);
  }
}

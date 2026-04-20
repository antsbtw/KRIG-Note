import type { EditorView } from 'prosemirror-view';
import type { ThoughtType, AnchorType } from '../../../shared/types/thought-types';
import { THOUGHT_TYPE_META } from '../../../shared/types/thought-types';
import { THOUGHT_ACTION } from '../../thought/thought-protocol';
import { blockSelectionKey } from '../plugins/block-selection';
import { addBlockFrameGroup } from './frame-commands';
import { selectionToMarkdown } from './selection-to-markdown';

/**
 * addThought — 在当前光标/选区位置创建 Thought 锚点
 *
 * 四条路径（按优先级）：
 * 0. block-selection plugin 激活 → 多 block 标注（线框）
 * 1. 有文字选择且在单 block 内部分文字 → inline mark（下划线）
 * 2. 光标在 textBlock 无选择 / 覆盖整段 → 单 block 标注（线框）
 * 3. 光标在 image/codeBlock/mathBlock 等 → node attr（outline 边框）
 */

const NODE_THOUGHT_TYPES = new Set(['image', 'codeBlock', 'mathBlock', 'mathVisual', 'videoPlaceholder', 'audioBlock']);

const viewAPI = () => (window as any).viewAPI as {
  thoughtCreate: (t: any) => Promise<any>;
  thoughtRelate: (noteId: string, thoughtId: string, edge: any) => Promise<void>;
  sendToOtherSlot: (msg: any) => void;
  ensureRightSlot: (workModeId: string) => Promise<void>;
  getActiveNoteId: () => Promise<string | null>;
} | undefined;

export async function addThought(
  view: EditorView,
  type: ThoughtType = 'thought',
  savedBlockPositions?: number[],
): Promise<void> {
  const api = viewAPI();
  if (!api) return;

  const noteId = await api.getActiveNoteId();
  if (!noteId) return;

  const { state } = view;
  const thoughtMarkType = state.schema.marks.thought;
  if (!thoughtMarkType) return;

  // ── 路径 0: 多 block 标注（block-selection 或外部传入的 positions） ──
  const blockSel = blockSelectionKey.getState(state);
  const multiBlockPositions = savedBlockPositions
    || (blockSel?.active && blockSel.selectedPositions.length > 0 ? blockSel.selectedPositions : null);
  if (multiBlockPositions && multiBlockPositions.length > 0) {
    await addBlockThought(view, api, noteId, type, thoughtMarkType, multiBlockPositions);
    return;
  }

  const { selection } = state;
  const { from, to, empty } = selection;

  let anchorType: AnchorType;
  let anchorText: string;
  let anchorPos: number = from;

  // ── 路径 3: node attr（image, codeBlock 等） ──
  const resolvedNode = state.doc.resolve(from);
  let nodeAtPos: any = null;
  let nodePos = -1;

  for (let d = resolvedNode.depth; d >= 0; d--) {
    const n = resolvedNode.node(d);
    if (NODE_THOUGHT_TYPES.has(n.type.name)) {
      nodeAtPos = n;
      nodePos = resolvedNode.before(d);
      break;
    }
  }

  if (nodeAtPos && nodeAtPos.type.spec.attrs?.thoughtId !== undefined) {
    anchorType = 'node';
    const nodeName = nodeAtPos.type.name;
    if (nodeName === 'image') {
      anchorText = `[图片] ${nodeAtPos.attrs.alt || ''}`.trim();
    } else if (nodeName === 'codeBlock') {
      anchorText = `[代码] ${nodeAtPos.textContent.slice(0, 60)}`;
    } else if (nodeName === 'mathBlock' || nodeName === 'mathVisual') {
      anchorText = `[公式] ${nodeAtPos.textContent.slice(0, 60)}`;
    } else {
      anchorText = `[${nodeName}]`;
    }
    anchorPos = nodePos;

    const record = await createRecord(api, noteId, anchorType, anchorText, anchorPos, type);
    if (!record) return;

    view.dispatch(state.tr.setNodeMarkup(nodePos, undefined, {
      ...nodeAtPos.attrs,
      thoughtId: record.id,
    }));

    await openAndNotify(api, record.id, anchorType, anchorText, anchorPos, type, noteId);
  } else if (!empty && isInlineSelection(state, from, to)) {
    // ── 路径 1: inline mark（段落内部分文字） ──
    anchorType = 'inline';
    // selectionToMarkdown 能正确提取行内公式等非文本节点
    const { markdown: selMd } = selectionToMarkdown(view);
    const firstLine = selMd.trim().split('\n').find(l => l.trim())?.trim() || '';
    anchorText = (firstLine || state.doc.textBetween(from, to, ' ')).slice(0, 100);

    const record = await createRecord(api, noteId, anchorType, anchorText, anchorPos, type);
    if (!record) return;

    const mark = thoughtMarkType.create({ thoughtId: record.id, thoughtType: type, anchorType: 'inline' });
    view.dispatch(state.tr.addMark(from, to, mark));

    await openAndNotify(api, record.id, anchorType, anchorText, anchorPos, type, noteId);
  } else {
    // ── 路径 2: 单 block 标注 ──
    // 找到光标所在的 top-level block position
    const depth = Math.min(selection.$from.depth, 1);
    const blockPos = selection.$from.before(depth);
    await addBlockThought(view, api, noteId, type, thoughtMarkType, [blockPos]);
  }
}

/** 路径 0 & 2 共用：给一组 block positions 添加 thought 标注（使用框定系统） */
async function addBlockThought(
  view: EditorView,
  api: NonNullable<ReturnType<typeof viewAPI>>,
  noteId: string,
  type: ThoughtType,
  thoughtMarkType: import('prosemirror-model').MarkType,
  positions: number[],
): Promise<void> {
  const state = view.state;
  const sorted = [...positions].sort((a, b) => a - b);

  // 收集 block 信息
  const validPositions: number[] = [];
  for (const pos of sorted) {
    const node = state.doc.nodeAt(pos);
    if (node) validPositions.push(pos);
  }
  if (validPositions.length === 0) return;

  const first = validPositions[0];
  const last = validPositions[validPositions.length - 1];
  const lastNode = state.doc.nodeAt(last);
  // 优先用 selectionToMarkdown（含行内公式），选区不匹配时 fallback 到 textBetween
  let anchorText: string;
  const { from: selFrom, to: selTo } = view.state.selection;
  if (selFrom !== selTo) {
    const { markdown: selMd } = selectionToMarkdown(view);
    const firstLine = selMd.trim().split('\n').find(l => l.trim())?.trim() || '';
    anchorText = firstLine.slice(0, 100);
  } else {
    anchorText = state.doc.textBetween(
      first + 1, last + (lastNode?.nodeSize ?? 1) - 1, ' ',
    ).slice(0, 100);
  }

  const record = await createRecord(api, noteId, 'block', anchorText, first, type);
  if (!record) return;

  // 使用框定系统：颜色来自 thought 类型，同时写入 thoughtId 用于锚定跳转
  const frameColor = THOUGHT_TYPE_META[type].color;
  addBlockFrameGroup(view, validPositions, frameColor, 'solid', record.id);

  await openAndNotify(api, record.id, 'block', anchorText, first, type, noteId);
}

/** 判断选区是否在单个 textBlock 内且不覆盖整段 */
function isInlineSelection(
  state: import('prosemirror-state').EditorState,
  from: number,
  to: number,
): boolean {
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if ($from.parent !== $to.parent) return false;
  const blockStart = $from.start($from.depth);
  const blockEnd = $from.end($from.depth);
  if (from <= blockStart && to >= blockEnd) return false;
  return true;
}

/** 在 DB 中创建 Thought 记录并建立图关系 */
async function createRecord(
  api: NonNullable<ReturnType<typeof viewAPI>>,
  noteId: string,
  anchorType: AnchorType,
  anchorText: string,
  anchorPos: number,
  type: ThoughtType,
) {
  const record = await api.thoughtCreate({
    anchor_type: anchorType,
    anchor_text: anchorText,
    anchor_pos: anchorPos,
    type,
    resolved: false,
    pinned: false,
    doc_content: [],
  });

  if (!record) return null;

  await api.thoughtRelate(noteId, record.id, {
    anchor_type: anchorType,
    anchor_pos: anchorPos,
    created_at: Date.now(),
  });

  return record;
}

/** 打开 Right Slot 并通知 ThoughtView */
async function openAndNotify(
  api: NonNullable<ReturnType<typeof viewAPI>>,
  thoughtId: string,
  anchorType: AnchorType,
  anchorText: string,
  anchorPos: number,
  type: ThoughtType,
  noteId: string,
): Promise<void> {
  await api.ensureRightSlot('thought');

  // ThoughtView 启动时会主动通过 getActiveNoteId + thoughtListByNote 拉取数据，
  // 所以即使下面的消息因为 renderer 未加载完而丢失，数据也不会丢。
  // 延迟发送 CREATE 消息用于即时 UI 更新（追加卡片 + 激活）。
  setTimeout(() => {
    api.sendToOtherSlot({
      protocol: 'note-thought',
      action: THOUGHT_ACTION.CREATE,
      payload: {
        thoughtId,
        anchorType,
        anchorText,
        anchorPos,
        type,
      },
    });
  }, 1000);
}

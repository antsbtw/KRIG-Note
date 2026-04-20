import type { EditorView } from 'prosemirror-view';
import type { AnchorType } from '../../../shared/types/thought-types';
import { THOUGHT_TYPE_META } from '../../../shared/types/thought-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';
import { THOUGHT_ACTION } from '../../thought/thought-protocol';
import { selectionToMarkdown } from './selection-to-markdown';
import { getSelectionCache } from './selection-cache';
import { addBlockFrameGroup } from './frame-commands';

/**
 * askAI — 选中文字后向 AI 提问，回复写入 Thought
 *
 * 新流程（用户可见 AI Web）：
 * 1. 获取选中文本 + 用户指令
 * 2. 在选中位置添加 thought mark（pending 状态）
 * 3. Right Slot 切换到 WebView:ai（用户看到 AI 页面）
 * 4. 通过 IPC 通知 main 进程：导航到 AI 服务 → 注入 SSE → 粘贴 → 发送
 * 5. 用户实时看到 AI 的回复过程
 * 6. SSE 拦截完成 → main 进程创建 ThoughtRecord
 * 7. Right Slot 切换到 ThoughtView → 显示 AI 回复
 * 8. 用户可以手动切回 AI Web 查看原始对话
 *
 * 设计文档：docs/web/AI-Workflow-Protocol-设计.md §四
 */

const viewAPI = () => (window as any).viewAPI as {
  thoughtCreate: (t: any) => Promise<any>;
  thoughtSave: (id: string, updates: any) => Promise<void>;
  thoughtRelate: (noteId: string, thoughtId: string, edge: any) => Promise<void>;
  sendToOtherSlot: (msg: any) => void;
  ensureRightSlot: (workModeId: string) => Promise<void>;
  openRightSlot: (workModeId: string) => Promise<void>;
  getActiveNoteId: () => Promise<string | null>;
  aiAskVisible: (params: {
    serviceId: string;
    prompt: string;
    noteId: string;
    thoughtId: string;
    images?: string[];
  }) => Promise<{ success: boolean; markdown?: string; error?: string }>;
} | undefined;

/**
 * Get the currently selected text from the editor.
 */
export function getSelectedText(view: EditorView): string {
  const { state } = view;
  const { from, to, empty } = state.selection;
  if (empty) return '';
  return state.doc.textBetween(from, to, '\n');
}

export async function askAI(
  view: EditorView,
  serviceId: AIServiceId,
  instruction: string,
  blockPositions?: number[],
): Promise<void> {
  const api = viewAPI();
  if (!api) return;

  const noteId = await api.getActiveNoteId();
  if (!noteId) return;

  const { state } = view;
  const thoughtMarkType = state.schema.marks.thought;
  if (!thoughtMarkType) return;

  // 优先用当前选区，选区为空时从 selection cache 读取
  let from = state.selection.from;
  let to = state.selection.to;
  let selectedMarkdown = '';
  let images: string[] = [];

  if (from !== to) {
    const result = selectionToMarkdown(view);
    selectedMarkdown = result.markdown;
    images = result.images;
  } else {
    // 选区被折叠（右键菜单场景）— 从缓存读取
    const cache = getSelectionCache();
    if (cache && cache.markdown.trim()) {
      selectedMarkdown = cache.markdown;
      images = cache.images;
      from = cache.from;
      to = cache.to;
    }
  }

  if (!selectedMarkdown.trim()) return;

  // Compose the full prompt: instruction + selected content (Markdown)
  const fullPrompt = instruction.trim()
    ? `${instruction.trim()}\n\n---\n\n${selectedMarkdown}`
    : selectedMarkdown;

  const anchorType: AnchorType = 'inline';
  // 直接从 selectedMarkdown 提取第一行作为摘要（含行内公式等非文本节点）
  const firstLine = selectedMarkdown.trim().split('\n').find(l => l.trim())?.trim() || '';
  const anchorText = (firstLine || state.doc.textBetween(from, Math.min(to, state.doc.content.size), ' ')).slice(0, 100);
  const anchorPos = from;

  // 1. Create ThoughtRecord in DB (pending state)
  const record = await api.thoughtCreate({
    anchor_type: anchorType,
    anchor_text: anchorText,
    anchor_pos: anchorPos,
    type: 'ai-response',
    resolved: false,
    pinned: false,
    doc_content: [],
    serviceId,
  });
  if (!record) return;

  // 2. Relate to note
  await api.thoughtRelate(noteId, record.id, {
    anchor_type: anchorType,
    anchor_pos: anchorPos,
    created_at: Date.now(),
  });

  // 3. 标注选区
  if (blockPositions && blockPositions.length > 0) {
    // 多 block 选择 → 使用框定系统
    const frameColor = THOUGHT_TYPE_META['ai-response'].color;
    addBlockFrameGroup(view, blockPositions, frameColor, 'solid');
  } else {
    // inline 选择 → 使用 thought mark
    const mark = thoughtMarkType.create({
      thoughtId: record.id,
      thoughtType: 'ai-response',
      anchorType: 'inline',
    });
    view.dispatch(view.state.tr.addMark(from, to, mark));
  }

  // 4. Open Right Slot with AI WebView — user sees the AI page
  console.log('[askAI] Step 4: Opening AI WebView in Right Slot...');
  await api.openRightSlot('ai-web');

  // 5. Send to AI via visible WebView (main process orchestrates)
  console.log('[askAI] Step 5: Sending to AI via aiAskVisible...', { serviceId, promptLength: fullPrompt.length, imageCount: images.length });
  const result = await api.aiAskVisible({
    serviceId,
    prompt: fullPrompt,
    noteId,
    thoughtId: record.id,
    images: images.length > 0 ? images : undefined,
  });

  console.log('[askAI] Step 5 result:', { success: result.success, markdownLength: result.markdown?.length ?? 0, error: result.error });

  // 6. AI response captured — switch to ThoughtView
  // Switch Right Slot to ThoughtView
  await api.openRightSlot('thought');

  // 等待 ThoughtView renderer 加载就绪（轮询检测，替代硬编码 setTimeout）
  await waitForSlotReady(api, 3000);

  console.log('[askAI] Step 6: Sending CREATE to ThoughtView...');

  // 先发送 CREATE，ThoughtView 追加卡片
  api.sendToOtherSlot({
    protocol: 'note-thought',
    action: THOUGHT_ACTION.CREATE,
    payload: {
      thoughtId: record.id,
      anchorType,
      anchorText,
      anchorPos,
      type: 'ai-response',
      serviceId,
    },
  });

  // 等一个 React 渲染周期，确保 CREATE 的 setState 已执行
  await nextFrame();

  if (result.success && result.markdown) {
    console.log('[askAI] Step 6: Sending AI_RESPONSE_READY...');
    api.sendToOtherSlot({
      protocol: 'note-thought',
      action: THOUGHT_ACTION.AI_RESPONSE_READY,
      payload: {
        thoughtId: record.id,
        markdown: result.markdown,
        serviceId,
      },
    });
  } else {
    console.log('[askAI] Step 6: Sending AI_ERROR...', result.error);
    api.sendToOtherSlot({
      protocol: 'note-thought',
      action: THOUGHT_ACTION.AI_ERROR,
      payload: {
        thoughtId: record.id,
        error: result.error || 'Unknown error',
      },
    });
  }
}

/** 等待 Right Slot renderer 加载就绪（轮询 sendToOtherSlot 可达性） */
async function waitForSlotReady(
  api: NonNullable<ReturnType<typeof viewAPI>>,
  timeoutMs: number = 3000,
): Promise<void> {
  const start = Date.now();
  const interval = 200;
  while (Date.now() - start < timeoutMs) {
    try {
      // sendToOtherSlot 在 slot 未就绪时会抛出或静默丢弃；
      // 我们发一个无害的探测消息，如果不抛就认为通道可用
      api.sendToOtherSlot({
        protocol: 'note-thought',
        action: '__probe__',
        payload: {},
      });
      return;
    } catch {
      await new Promise(r => setTimeout(r, interval));
    }
  }
  // 超时后仍然尝试发送（ThoughtView 启动时也会从 DB 拉取，消息丢失不致命）
  console.warn('[askAI] waitForSlotReady timed out, proceeding anyway');
}

/** 等一个 requestAnimationFrame + microtask，确保 React setState 已 flush */
function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 50);
    }
  });
}

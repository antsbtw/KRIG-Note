import type { EditorView } from 'prosemirror-view';
import type { AnchorType } from '../../../shared/types/thought-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';
import { THOUGHT_ACTION } from '../../thought/thought-protocol';

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
): Promise<void> {
  const api = viewAPI();
  if (!api) return;

  const noteId = await api.getActiveNoteId();
  if (!noteId) return;

  const { state } = view;
  const { selection } = state;
  const { from, to, empty } = selection;
  const thoughtMarkType = state.schema.marks.thought;
  if (!thoughtMarkType) return;

  if (empty) return;

  const selectedText = state.doc.textBetween(from, to, '\n');
  if (!selectedText.trim()) return;

  // Compose the full prompt: instruction + selected content
  const fullPrompt = instruction.trim()
    ? `${instruction.trim()}\n\n---\n\n${selectedText}`
    : selectedText;

  const anchorType: AnchorType = 'inline';
  const anchorText = selectedText.slice(0, 100);
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

  // 3. Add thought mark to selection
  const mark = thoughtMarkType.create({
    thoughtId: record.id,
    thoughtType: 'ai-response',
  });
  view.dispatch(state.tr.addMark(from, to, mark));

  // 4. Open Right Slot with AI WebView — user sees the AI page
  await api.openRightSlot('ai-web');

  // 5. Send to AI via visible WebView (main process orchestrates)
  //    Main will: navigate to AI URL → inject SSE → paste → send → wait → capture
  //    User sees the entire process in the Right Slot
  const result = await api.aiAskVisible({
    serviceId,
    prompt: fullPrompt,
    noteId,
    thoughtId: record.id,
  });

  // 6. AI response captured — switch to ThoughtView
  if (result.success && result.markdown) {
    // Switch Right Slot to ThoughtView
    await api.openRightSlot('thought');

    // Wait a moment for ThoughtView to load
    await new Promise(resolve => setTimeout(resolve, 800));

    // Notify ThoughtView: new AI thought with content
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

    // Send the response content
    setTimeout(() => {
      api.sendToOtherSlot({
        protocol: 'note-thought',
        action: THOUGHT_ACTION.AI_RESPONSE_READY,
        payload: {
          thoughtId: record.id,
          markdown: result.markdown,
          serviceId,
        },
      });
    }, 500);
  } else {
    // Failed — switch to ThoughtView and show error
    await api.openRightSlot('thought');
    await new Promise(resolve => setTimeout(resolve, 800));

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

    setTimeout(() => {
      api.sendToOtherSlot({
        protocol: 'note-thought',
        action: THOUGHT_ACTION.AI_ERROR,
        payload: {
          thoughtId: record.id,
          error: result.error || 'Unknown error',
        },
      });
    }, 500);
  }
}

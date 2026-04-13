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
  console.log('[askAI] Step 4: Opening AI WebView in Right Slot...');
  await api.openRightSlot('ai-web');

  // 5. Send to AI via visible WebView (main process orchestrates)
  console.log('[askAI] Step 5: Sending to AI via aiAskVisible...', { serviceId, promptLength: fullPrompt.length });
  const result = await api.aiAskVisible({
    serviceId,
    prompt: fullPrompt,
    noteId,
    thoughtId: record.id,
  });

  console.log('[askAI] Step 5 result:', { success: result.success, markdownLength: result.markdown?.length ?? 0, error: result.error });

  // 6. AI response captured — switch to ThoughtView
  if (result.success && result.markdown) {
    console.log('[askAI] Step 6: AI responded successfully (main handler already parsed + saved atoms)');
    // Note: The main IPC handler (AI_ASK_VISIBLE) already parsed the markdown
    // into structured Atoms via ResultParser + createAtomsFromExtracted
    // and saved them to ThoughtStore. We just need to switch to ThoughtView.

    // Switch Right Slot to ThoughtView
    await api.openRightSlot('thought');

    // Wait for ThoughtView to load
    await new Promise(resolve => setTimeout(resolve, 1200));

    console.log('[askAI] Step 6: Sending CREATE + AI_RESPONSE_READY to ThoughtView...');

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

    // Send the response content (delay to ensure CREATE is processed first)
    setTimeout(() => {
      console.log('[askAI] Step 6: Sending AI_RESPONSE_READY with markdown...');
      api.sendToOtherSlot({
        protocol: 'note-thought',
        action: THOUGHT_ACTION.AI_RESPONSE_READY,
        payload: {
          thoughtId: record.id,
          markdown: result.markdown,
          serviceId,
        },
      });
    }, 800);
  } else {
    console.log('[askAI] Step 6: AI FAILED, switching to ThoughtView for error display...', result.error);

    // Switch Right Slot to ThoughtView and show error
    await api.openRightSlot('thought');
    await new Promise(resolve => setTimeout(resolve, 1200));

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
    }, 800);
  }
}

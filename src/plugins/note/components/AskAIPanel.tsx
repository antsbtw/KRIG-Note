import { useState, useEffect, useRef, useCallback } from 'react';
import type { EditorView } from 'prosemirror-view';
import { askAI } from '../commands/ask-ai-command';
import { selectionToMarkdown } from '../commands/selection-to-markdown';
import { blockSelectionKey } from '../plugins/block-selection';
import { getAIServiceList, DEFAULT_AI_SERVICE } from '../../../shared/types/ai-service-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';

/**
 * AskAIPanel — 独立浮窗组件
 *
 * 由 ContextMenu / HandleMenu 通过自定义事件 `open-ask-ai-panel` 触发。
 * 菜单发事件后自行收起，AskAIPanel 独立浮动显示。
 *
 * 事件 detail: { coords: { left, top }, contentPreview: string }
 */

interface AskAIPanelProps {
  view: EditorView | null;
}

interface PanelState {
  coords: { left: number; top: number };
  contentPreview: string;
  blockPositions: number[];
}

export function AskAIPanel({ view }: AskAIPanelProps) {
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [instruction, setInstruction] = useState('');
  const [serviceId, setServiceId] = useState<AIServiceId>(DEFAULT_AI_SERVICE);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 监听打开事件
  useEffect(() => {
    if (!view) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setPanel({
        coords: detail.coords,
        contentPreview: detail.contentPreview || '',
        blockPositions: detail.blockPositions || [],
      });
      setInstruction('');
      setShowServiceMenu(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    };

    view.dom.addEventListener('open-ask-ai-panel', handler);
    return () => view.dom.removeEventListener('open-ask-ai-panel', handler);
  }, [view]);

  // 点击外部关闭
  useEffect(() => {
    if (!panel) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanel(null);
      }
    };
    // 延迟注册，避免打开时的 click 立即关闭
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 100);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handler); };
  }, [panel]);

  const close = useCallback(() => {
    setPanel(null);
    view?.focus();
  }, [view]);

  const handleSend = useCallback(() => {
    if (!view || !panel) return;
    if (!instruction.trim() && !panel.contentPreview.trim()) return;
    askAI(view, serviceId, instruction, panel.blockPositions.length > 0 ? panel.blockPositions : undefined);
    setPanel(null);
  }, [view, panel, instruction, serviceId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') close();
  };

  if (!panel || !view) return null;

  const services = getAIServiceList();
  const currentService = services.find(s => s.id === serviceId) || services[0];
  const preview = panel.contentPreview.length > 200
    ? panel.contentPreview.slice(0, 200) + '...'
    : panel.contentPreview;

  // 视口边界修正
  const pad = 8;
  let { left, top } = panel.coords;
  if (left + 330 > window.innerWidth - pad) left = window.innerWidth - 330 - pad;
  if (top + 280 > window.innerHeight - pad) top = window.innerHeight - 280 - pad;
  if (left < pad) left = pad;
  if (top < pad) top = pad;

  return (
    <div
      ref={panelRef}
      style={{ ...styles.container, left, top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={styles.header}>
        <span style={{ color: '#aaa', fontSize: 12 }}>🤖 问 AI</span>
        <button style={styles.closeBtn} onClick={close} title="关闭 (Esc)">×</button>
      </div>

      {/* Preview */}
      {preview && (
        <div style={styles.preview}>
          <span style={styles.previewLabel}>选中内容：</span>
          <pre style={styles.previewText}>{preview}</pre>
        </div>
      )}

      {/* Input */}
      <textarea
        ref={inputRef}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="请输入你的问题..."
        style={styles.textarea}
        rows={2}
      />

      {/* Bottom bar */}
      <div style={styles.bottomBar}>
        <div style={{ position: 'relative' }}>
          <button style={styles.serviceBtn} onClick={() => setShowServiceMenu(!showServiceMenu)}>
            {currentService.icon} {currentService.name} ▾
          </button>
          {showServiceMenu && (
            <div style={styles.serviceMenu}>
              {services.map((s) => (
                <button
                  key={s.id}
                  style={{ ...styles.serviceOption, background: s.id === serviceId ? '#3a3a3a' : 'transparent' }}
                  onClick={() => { setServiceId(s.id as AIServiceId); setShowServiceMenu(false); }}
                >
                  {s.icon} {s.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          style={{ ...styles.sendBtn, opacity: (!instruction.trim() && !preview.trim()) ? 0.4 : 1 }}
          onClick={handleSend}
          disabled={!instruction.trim() && !preview.trim()}
        >
          发送 ▶
        </button>
      </div>
    </div>
  );
}

/**
 * 触发 AskAIPanel 打开（供 ContextMenu / HandleMenu 调用）
 *
 * 自动检测当前上下文生成内容预览：
 * - block-selection → 多 block 文本
 * - 有选区 → Markdown
 * - 无选区 → 光标所在 block 文本
 */
export function openAskAIPanel(
  view: EditorView,
  coords: { left: number; top: number },
  precomputedPreview?: string,
  blockPositions?: number[],
): void {
  let contentPreview = precomputedPreview || '';

  if (!contentPreview) {
    const state = view.state;

    // 多 block 选择
    const blockSel = blockSelectionKey.getState(state);
    if (blockSel?.active && blockSel.selectedPositions.length > 0) {
      const sorted = [...blockSel.selectedPositions].sort((a, b) => a - b);
      const first = sorted[0];
      const lastPos = sorted[sorted.length - 1];
      const lastNode = state.doc.nodeAt(lastPos);
      const to = lastNode ? lastPos + lastNode.nodeSize : lastPos + 1;
      contentPreview = state.doc.textBetween(first, to, '\n\n').slice(0, 500);
    } else {
      const { from, to } = state.selection;
      if (from !== to) {
        contentPreview = selectionToMarkdown(view).markdown;
      } else {
        // 无选区 → 当前 block
        const $from = state.selection.$from;
        const depth = Math.min($from.depth, 1);
        const blockStart = $from.start(depth);
        const blockEnd = $from.end(depth);
        contentPreview = state.doc.textBetween(blockStart, blockEnd, '\n').slice(0, 500);
      }
    }
  }

  view.dom.dispatchEvent(new CustomEvent('open-ask-ai-panel', {
    detail: { coords, contentPreview, blockPositions: blockPositions || [] },
  }));
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed', zIndex: 1100,
    background: '#2a2a2a', border: '1px solid #555', borderRadius: 10,
    padding: 12, width: 320, boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8,
  },
  closeBtn: {
    background: 'transparent', border: 'none', color: '#888',
    fontSize: 16, cursor: 'pointer', padding: '0 4px', lineHeight: 1,
  },
  preview: {
    background: '#1e1e1e', borderRadius: 6, padding: '8px 10px',
    marginBottom: 8, fontSize: 12, lineHeight: '1.4', borderLeft: '3px solid #6366f1',
  },
  previewLabel: { color: '#888', display: 'block', marginBottom: 4, fontSize: 11 },
  previewText: {
    color: '#ccc', wordBreak: 'break-word' as const, whiteSpace: 'pre-wrap' as const,
    fontFamily: 'ui-monospace, "SF Mono", Monaco, "Cascadia Code", monospace',
    fontSize: 11, margin: 0, maxHeight: 120, overflowY: 'auto' as const,
  },
  textarea: {
    width: '100%', background: '#1e1e1e', border: '1px solid #444', borderRadius: 6,
    color: '#e8eaed', fontSize: 13, padding: '8px 10px', resize: 'vertical' as const,
    outline: 'none', fontFamily: 'inherit', lineHeight: '1.4', boxSizing: 'border-box' as const,
  },
  bottomBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  serviceBtn: {
    background: '#333', border: '1px solid #555', borderRadius: 6,
    color: '#ccc', fontSize: 12, padding: '4px 10px', cursor: 'pointer',
  },
  serviceMenu: {
    position: 'absolute' as const, bottom: '100%', left: 0, marginBottom: 4,
    background: '#2a2a2a', border: '1px solid #444', borderRadius: 8,
    padding: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', minWidth: 120,
  },
  serviceOption: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
    padding: '6px 12px', border: 'none', color: '#e8eaed',
    fontSize: 12, cursor: 'pointer', borderRadius: 4, textAlign: 'left' as const,
  },
  sendBtn: {
    background: '#6366f1', border: 'none', borderRadius: 6,
    color: '#fff', fontSize: 12, padding: '5px 14px', cursor: 'pointer', fontWeight: 600,
  },
};

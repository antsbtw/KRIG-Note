import { useState, useEffect, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import { selectionToMarkdown } from '../commands/selection-to-markdown';
import { getAIServiceList, DEFAULT_AI_SERVICE } from '../../../shared/types/ai-service-types';
import type { AIServiceId } from '../../../shared/types/ai-service-types';

/**
 * AskAIPanel — 问 AI 弹窗（ContextMenu / HandleMenu 共用）
 *
 * 显示选中内容的 Markdown 预览 + 指令输入框 + AI 服务选择 + 发送按钮。
 * 调用方通过 contentPreview 传入预览文本（可选），否则从 view 当前选区读取。
 */

interface AskAIPanelProps {
  view: EditorView;
  /** 预渲染的内容预览（用于 block-selection 等选区已丢失的场景） */
  contentPreview?: string;
  onSend: (serviceId: AIServiceId, instruction: string) => void;
  onClose: () => void;
}

export function AskAIPanel({ view, contentPreview, onSend, onClose }: AskAIPanelProps) {
  const [instruction, setInstruction] = useState('');
  const [serviceId, setServiceId] = useState<AIServiceId>(DEFAULT_AI_SERVICE);
  const [showServiceMenu, setShowServiceMenu] = useState(false);
  const [previewMarkdown] = useState(() => contentPreview || selectionToMarkdown(view).markdown);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const handleSend = () => {
    if (!instruction.trim() && !previewMarkdown.trim()) return;
    onSend(serviceId, instruction);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const services = getAIServiceList();
  const currentService = services.find(s => s.id === serviceId) || services[0];
  const previewText = previewMarkdown.length > 200 ? previewMarkdown.slice(0, 200) + '...' : previewMarkdown;

  return (
    <div
      style={styles.container}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={styles.header}>
        <span style={{ color: '#aaa', fontSize: 12 }}>🤖 问 AI</span>
        <button style={styles.closeBtn} onClick={onClose} title="关闭 (Esc)">×</button>
      </div>

      {/* Preview */}
      <div style={styles.preview}>
        <span style={styles.previewLabel}>
          选中内容：
          {!previewText && <span style={{ color: '#666', fontStyle: 'italic' }}>请在编辑器中选择文字</span>}
        </span>
        {previewText && <pre style={styles.previewText}>{previewText}</pre>}
      </div>

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
          style={{ ...styles.sendBtn, opacity: (!instruction.trim() && !previewMarkdown.trim()) ? 0.4 : 1 }}
          onClick={handleSend}
          disabled={!instruction.trim() && !previewMarkdown.trim()}
        >
          发送 ▶
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#2a2a2a', border: '1px solid #555', borderRadius: 10,
    padding: 12, width: 320, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 1000,
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

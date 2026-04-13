import { useState, useCallback, useRef, useEffect } from 'react';
import type { ThoughtRecord, ThoughtType } from '../../../shared/types/thought-types';
import { THOUGHT_TYPE_META } from '../../../shared/types/thought-types';
import { ThoughtEditor } from './ThoughtEditor';
import { getAIServiceProfile } from '../../../shared/types/ai-service-types';

/**
 * ThoughtCard — 单个 Thought 的卡片组件
 *
 * Toggle 展开/收起。收起时销毁 EditorView，展开时重建（性能优化）。
 */

interface ThoughtCardProps {
  thought: ThoughtRecord;
  isActive: boolean;
  onActivate: (id: string) => void;
  onSave: (id: string, updates: Partial<ThoughtRecord>) => void;
  onDelete: (id: string) => void;
  onScrollToAnchor: (thoughtId: string) => void;
  onTypeChange: (id: string, newType: ThoughtType) => void;
}

export function ThoughtCard({
  thought,
  isActive,
  onActivate,
  onSave,
  onDelete,
  onScrollToAnchor,
  onTypeChange,
}: ThoughtCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 激活时自动展开并滚动到可见区域
  useEffect(() => {
    if (isActive && !expanded) {
      setExpanded(true);
    }
    if (isActive && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [isActive]);

  const isAI = thought.type === 'ai-response';
  const meta = THOUGHT_TYPE_META[thought.type];
  const aiServiceName = isAI && thought.serviceId
    ? (() => { try { return getAIServiceProfile(thought.serviceId as any).name; } catch { return thought.serviceId; } })()
    : null;

  // 提取标题：content 中第一段非空文字
  const title = extractTitle(thought);
  const isPending = isAI && thought.doc_content.length === 0;

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
    onActivate(thought.id);
  }, [thought.id, onActivate]);

  const handleContentChange = useCallback(
    (atoms: any[]) => {
      onSave(thought.id, { doc_content: atoms });
    },
    [thought.id, onSave],
  );

  const handleResolve = useCallback(() => {
    onSave(thought.id, { resolved: !thought.resolved });
  }, [thought.id, thought.resolved, onSave]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div
      ref={cardRef}
      className={`thought-card ${isActive ? 'thought-card--active' : ''} ${thought.resolved ? 'thought-card--resolved' : ''}`}
      style={isActive ? { borderColor: meta.color, borderWidth: 2 } : undefined}
    >
      {/* Header */}
      <div className="thought-card__header" onClick={handleToggle}>
        <span className="thought-card__icon">{meta.icon}</span>
        <span className="thought-card__title">
          {isAI
            ? (isPending
              ? `${aiServiceName || 'AI'} 思考中...`
              : (title || `${aiServiceName || 'AI'} 回复`))
            : (title || '空思考')
          }
        </span>
        {isAI && aiServiceName && (
          <span className="thought-card__service" style={{ color: meta.color, fontSize: 11, marginLeft: 4 }}>
            {aiServiceName}
          </span>
        )}
        <span className="thought-card__time">{formatTime(thought.created_at)}</span>
        <span className="thought-card__chevron">{expanded ? '▾' : '▸'}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <>
          {/* Anchor preview */}
          <div
            className="thought-card__anchor"
            onClick={() => onScrollToAnchor(thought.id)}
            title="点击跳转到原文位置"
            style={{ borderLeftColor: meta.color }}
          >
            <span className="thought-card__anchor-text">{thought.anchor_text}</span>
            <span className="thought-card__anchor-jump">↗</span>
          </div>

          {/* Editor */}
          <div className="thought-card__editor">
            <ThoughtEditor
              initialContent={thought.doc_content}
              onContentChange={handleContentChange}
            />
          </div>

          {/* Action bar */}
          <div className="thought-card__actions">
            {/* Type switcher */}
            <div className="thought-card__type-switcher">
              <button
                className="thought-card__action-btn"
                onClick={() => setShowTypeMenu(!showTypeMenu)}
              >
                {meta.icon} {meta.label} ▾
              </button>
              {showTypeMenu && (
                <div className="thought-card__type-menu">
                  {(Object.keys(THOUGHT_TYPE_META) as ThoughtType[]).map((t) => (
                    <button
                      key={t}
                      className={`thought-card__type-option ${t === thought.type ? 'thought-card__type-option--active' : ''}`}
                      onClick={() => {
                        onTypeChange(thought.id, t);
                        setShowTypeMenu(false);
                      }}
                    >
                      {THOUGHT_TYPE_META[t].icon} {THOUGHT_TYPE_META[t].label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* AI-specific actions */}
            {isAI && !isPending && (
              <button
                className="thought-card__action-btn"
                onClick={() => {
                  const text = extractFullText(thought);
                  if (text) navigator.clipboard.writeText(text);
                }}
                title="复制 Markdown"
              >
                📋 复制
              </button>
            )}

            <button
              className={`thought-card__action-btn ${thought.resolved ? 'thought-card__action-btn--resolved' : ''}`}
              onClick={handleResolve}
            >
              {thought.resolved ? '↩ 重开' : '✓ 完成'}
            </button>

            <button
              className="thought-card__action-btn thought-card__action-btn--danger"
              onClick={() => onDelete(thought.id)}
            >
              🗑
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function extractFullText(thought: ThoughtRecord): string {
  if (!thought.doc_content || thought.doc_content.length === 0) return '';
  const parts: string[] = [];
  for (const atom of thought.doc_content) {
    const content = atom.content as any;
    if (content?.children) {
      for (const child of content.children) {
        if (child.type === 'text' && child.text) parts.push(child.text);
      }
    }
  }
  return parts.join('\n');
}

function extractTitle(thought: ThoughtRecord): string {
  if (!thought.doc_content || thought.doc_content.length === 0) return '';
  for (const atom of thought.doc_content) {
    const content = atom.content as any;
    if (content?.children) {
      for (const child of content.children) {
        if (child.type === 'text' && child.text?.trim()) {
          return child.text.trim().slice(0, 60);
        }
      }
    }
  }
  return '';
}

import { useMemo } from 'react';
import type { ThoughtRecord, ThoughtType } from '../../../shared/types/thought-types';
import { THOUGHT_TYPE_META } from '../../../shared/types/thought-types';
import { ThoughtCard } from './ThoughtCard';

/**
 * ThoughtPanel — 面板列表
 *
 * 管理 ThoughtCard 列表，支持按文档位置排序。
 * 过滤和排序功能在 Phase 2 实现。
 */

interface ThoughtPanelProps {
  thoughts: ThoughtRecord[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onSave: (id: string, updates: Partial<ThoughtRecord>) => void;
  onDelete: (id: string) => void;
  onScrollToAnchor: (thoughtId: string) => void;
  onTypeChange: (id: string, newType: ThoughtType) => void;
}

export function ThoughtPanel({
  thoughts,
  activeId,
  onActivate,
  onSave,
  onDelete,
  onScrollToAnchor,
  onTypeChange,
}: ThoughtPanelProps) {
  // 按文档位置排序
  const sorted = useMemo(
    () => [...thoughts].sort((a, b) => a.anchor_pos - b.anchor_pos),
    [thoughts],
  );

  return (
    <div className="thought-panel">
      <div className="thought-panel__list">
        {sorted.length === 0 ? (
          <div className="thought-panel__empty">
            <p>还没有思考</p>
            <p style={{ fontSize: '12px', opacity: 0.5, marginTop: 4 }}>
              选中文字后按 ⌘⇧M 或点击 💭 按钮添加
            </p>
          </div>
        ) : (
          sorted.map((thought) => (
            <ThoughtCard
              key={thought.id}
              thought={thought}
              isActive={thought.id === activeId}
              onActivate={onActivate}
              onSave={onSave}
              onDelete={onDelete}
              onScrollToAnchor={onScrollToAnchor}
              onTypeChange={onTypeChange}
            />
          ))
        )}
      </div>
    </div>
  );
}

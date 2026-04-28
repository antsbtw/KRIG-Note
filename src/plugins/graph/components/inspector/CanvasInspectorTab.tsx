/**
 * 全图布局参数子组件 — 编辑全图的方向 / 边样式 / 间距。
 *
 * 用作 LayoutInspectorTab 的上栏（无卡片框，扁平流式布局，依赖外层分隔与下栏隔开）。
 *
 * 数据流：用户点按钮 → onSetLayoutOption 写 atom → 上层 reload → 新 atom
 *        进入 layoutOptions → 按钮高亮态更新。
 *
 * 详见 docs/graph/KRIG-Graph-Canvas-Spec.md §3.2
 */
import { useState } from 'react';

export interface CanvasInspectorTabProps {
  graphId: string;
  layoutId: string;
  layoutOptions: Record<string, string>;
  onSetLayoutOption: (attribute: string, value: string) => Promise<void>;
}

const DIRECTIONS = [
  { value: 'DOWN', label: '⬇' },
  { value: 'UP', label: '⬆' },
  { value: 'LEFT', label: '⬅' },
  { value: 'RIGHT', label: '➡' },
] as const;

const EDGE_STYLES = [
  { value: 'straight', label: '直线' },
  { value: 'orthogonal', label: '直角' },
  { value: 'polyline', label: '折线' },
  { value: 'splines', label: '曲线' },
] as const;

const SPACING_PRESETS = [
  { value: '40', label: '紧' },
  { value: '60', label: '中' },
  { value: '100', label: '松' },
  { value: '160', label: '宽' },
] as const;

export function CanvasInspectorTab({ layoutId, layoutOptions, onSetLayoutOption }: CanvasInspectorTabProps) {
  const isTree = layoutId === 'tree' || layoutId === 'tree-hierarchy' || layoutId === 'tree-layered';

  const currentDirection = layoutOptions['layout.direction'] ?? 'DOWN';
  const currentEdgeStyle = layoutOptions['layout.edge-style'] ?? 'straight';
  const currentNodeSpacing = layoutOptions['layout.spacing.node'] ?? defaultNodeSpacing(layoutId);
  const currentLayerSpacing = layoutOptions['layout.spacing.layer'] ?? '80';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {isTree && (
        <Section title="方向">
          <ButtonRow>
            {DIRECTIONS.map((d) => (
              <SegButton
                key={d.value}
                active={currentDirection === d.value}
                onClick={() => onSetLayoutOption('layout.direction', d.value)}
              >
                {d.label}
              </SegButton>
            ))}
          </ButtonRow>
        </Section>
      )}

      {isTree && (
        <Section title="边样式">
          <ButtonRow>
            {EDGE_STYLES.map((s) => (
              <SegButton
                key={s.value}
                active={currentEdgeStyle === s.value}
                onClick={() => onSetLayoutOption('layout.edge-style', s.value)}
              >
                {s.label}
              </SegButton>
            ))}
          </ButtonRow>
        </Section>
      )}

      <Section title="节点间距">
        <ButtonRow>
          {SPACING_PRESETS.map((s) => (
            <SegButton
              key={s.value}
              active={currentNodeSpacing === s.value}
              onClick={() => onSetLayoutOption('layout.spacing.node', s.value)}
            >
              {s.label}
            </SegButton>
          ))}
        </ButtonRow>
        <CustomNumberInput
          value={currentNodeSpacing}
          onCommit={(v) => onSetLayoutOption('layout.spacing.node', v)}
        />
      </Section>

      {isTree && (
        <Section title="层间距">
          <CustomNumberInput
            value={currentLayerSpacing}
            onCommit={(v) => onSetLayoutOption('layout.spacing.layer', v)}
          />
        </Section>
      )}

      {!isTree && (
        <div style={hintStyle}>
          切到"层级树"以编辑方向 / 边样式 / 层间距
        </div>
      )}
    </div>
  );
}

function defaultNodeSpacing(layoutId: string): string {
  if (layoutId === 'force') return '80';
  if (layoutId === 'grid') return '40';
  return '60';  // tree 类默认
}

// ── 子组件 ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function ButtonRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 4 }}>{children}</div>;
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...segButtonStyle,
        ...(active ? segButtonActiveStyle : {}),
      }}
    >
      {children}
    </button>
  );
}

function CustomNumberInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  if (draft !== value && document.activeElement?.tagName !== 'INPUT') {
    setTimeout(() => setDraft(value), 0);
  }
  const commit = () => {
    if (draft === value) return;
    if (!/^\d+(\.\d+)?$/.test(draft)) {
      setDraft(value);
      return;
    }
    onCommit(draft);
  };
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={inputStyle}
    />
  );
}

// ── 样式 ──

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const segButtonStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  color: '#bbb',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#333',
  fontSize: 12,
  padding: '5px 0',
  borderRadius: 3,
  cursor: 'pointer',
  outline: 'none',
};

const segButtonActiveStyle: React.CSSProperties = {
  background: '#3b82f6',
  color: '#fff',
  borderColor: '#60a5fa',
};

const inputStyle: React.CSSProperties = {
  background: '#0f0f10',
  color: '#e8eaed',
  border: '1px solid #333',
  borderRadius: 3,
  fontSize: 12,
  padding: '4px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#666',
  fontStyle: 'italic',
  textAlign: 'center',
  padding: '8px 0 0',
};

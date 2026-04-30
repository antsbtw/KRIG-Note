import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Instance } from '../../../library/types';

/**
 * FloatingInspector — 浮层属性面板(spec Canvas.md §3.4)
 *
 * 视觉:浮层 popover,默认右上;header 可拖动改位置;localStorage 记忆
 * 功能:
 * - 单选:Position(X/Y/W/H)+ Fill color + Line color/width
 * - 多选:仅显示"N items selected"提示 + Combine 按钮(M1.4d 接通)
 * - 空选:不渲染(由父控制)
 *
 * v1 不做(留 v1.1):
 * - Arrow 字段
 * - SubstanceProps(props.label / gender / birth / death 等)
 * - dash type 选择 / 透明度 slider
 * - 拖动后位置 per-noteId 记忆(M1.5b 接持久化时再做)
 */

const STORAGE_KEY = 'canvas:inspector:pos';
const DEFAULT_POS = { right: 12, top: 60 };  // 距右上角的偏移
const PANEL_W = 240;

export interface FloatingInspectorProps {
  /** 是否显示;默认隐藏,双击节点才打开 */
  open: boolean;
  selectedIds: string[];
  /** 从 NodeRenderer 取原始 Instance */
  getInstance: (id: string) => Instance | undefined;
  /** Inspector 改了属性,父组件应用 patch 并重渲染 */
  onUpdate: (id: string, patch: Partial<Instance>) => void;
  /** 用户点 × 关闭浮层 */
  onClose: () => void;
  /** 多选时显示 Combine 按钮(M1.4d 接通) */
  onCombine?: () => void;
}

export function FloatingInspector(props: FloatingInspectorProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => loadPos());
  const dragRef = useRef<{ startX: number; startY: number; startPanelX: number; startPanelY: number } | null>(null);

  // 持久化拖动后位置
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
      // 忽略 localStorage 限制
    }
  }, [pos]);

  // 拖动 header
  const handleHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!panelRef.current) return;
    const rect = panelRef.current.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanelX: rect.left,
      startPanelY: rect.top,
    };
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newLeft = dragRef.current.startPanelX + dx;
      const newTop = dragRef.current.startPanelY + dy;
      // clamp 到 viewport 内
      const maxLeft = window.innerWidth - PANEL_W - 4;
      const clampedLeft = Math.max(4, Math.min(maxLeft, newLeft));
      const clampedTop = Math.max(4, Math.min(window.innerHeight - 60, newTop));
      setPos({ left: clampedLeft, top: clampedTop });
    };
    const onMouseUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // 默认隐藏(单击节点不打开 Inspector,双击才打开,见 spec §3.4)
  if (!props.open) return null;
  if (props.selectedIds.length === 0) return null;

  // 多选
  if (props.selectedIds.length > 1) {
    return (
      <div ref={panelRef} style={{ ...styles.panel, ...resolvePosStyle(pos) }}>
        <Header
          label={`${props.selectedIds.length} items selected`}
          onMouseDown={handleHeaderMouseDown}
          onClose={props.onClose}
        />
        <div style={styles.body}>
          <div style={styles.multiHint}>
            多选模式:
            <br />
            • Delete / Backspace 删除
            <br />
            • 点空白取消选区
          </div>
          {props.onCombine && (
            <button style={styles.combineBtn} onClick={props.onCombine}>
              ⊟ Combine to Substance
            </button>
          )}
        </div>
      </div>
    );
  }

  // 单选
  const id = props.selectedIds[0];
  const inst = props.getInstance(id);
  if (!inst) return null;

  return (
    <div ref={panelRef} style={{ ...styles.panel, ...resolvePosStyle(pos) }}>
      <Header
        label="Format Shape"
        onMouseDown={handleHeaderMouseDown}
        onClose={props.onClose}
      />
      <div style={styles.body}>
        <PositionSection inst={inst} onUpdate={(patch) => props.onUpdate(id, patch)} />
        <FillSection inst={inst} onUpdate={(patch) => props.onUpdate(id, patch)} />
        <LineSection inst={inst} onUpdate={(patch) => props.onUpdate(id, patch)} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────

function Header({
  label, onMouseDown, onClose,
}: {
  label: string;
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onClose: () => void;
}) {
  return (
    <div style={styles.header} onMouseDown={onMouseDown}>
      <span style={styles.headerTitle}>{label}</span>
      <button
        type="button"
        style={styles.headerCloseBtn}
        onMouseDown={(e) => e.stopPropagation()}  // 不触发拖动
        onClick={onClose}
        title="关闭(ESC)"
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 子面板
// ─────────────────────────────────────────────────────────

function PositionSection(props: { inst: Instance; onUpdate: (patch: Partial<Instance>) => void }) {
  const { inst, onUpdate } = props;
  // line 实例 endpoints 模式不展示 X/Y/W/H(留 v1.1)
  if (!inst.position || !inst.size) return null;

  return (
    <Section title="Position">
      <Row>
        <NumField label="X" value={inst.position.x} onCommit={(v) => onUpdate({ position: { ...inst.position!, x: v } })} />
        <NumField label="Y" value={inst.position.y} onCommit={(v) => onUpdate({ position: { ...inst.position!, y: v } })} />
      </Row>
      <Row>
        <NumField label="W" value={inst.size.w} onCommit={(v) => onUpdate({ size: { ...inst.size!, w: Math.max(1, v) } })} />
        <NumField label="H" value={inst.size.h} onCommit={(v) => onUpdate({ size: { ...inst.size!, h: Math.max(1, v) } })} />
      </Row>
    </Section>
  );
}

function FillSection(props: { inst: Instance; onUpdate: (patch: Partial<Instance>) => void }) {
  const { inst, onUpdate } = props;
  const currentColor = inst.style_overrides?.fill?.color ?? '#4A90E2';
  return (
    <Section title="Fill">
      <Row>
        <ColorField
          label="Color"
          value={currentColor}
          onChange={(c) =>
            onUpdate({
              style_overrides: {
                ...inst.style_overrides,
                fill: { ...inst.style_overrides?.fill, type: 'solid', color: c },
              },
            })
          }
        />
      </Row>
    </Section>
  );
}

function LineSection(props: { inst: Instance; onUpdate: (patch: Partial<Instance>) => void }) {
  const { inst, onUpdate } = props;
  const currentColor = inst.style_overrides?.line?.color ?? '#2E5C8A';
  const currentWidth = inst.style_overrides?.line?.width ?? 1.5;
  return (
    <Section title="Line">
      <Row>
        <ColorField
          label="Color"
          value={currentColor}
          onChange={(c) =>
            onUpdate({
              style_overrides: {
                ...inst.style_overrides,
                line: { ...inst.style_overrides?.line, type: 'solid', color: c },
              },
            })
          }
        />
      </Row>
      <Row>
        <NumField
          label="Width"
          value={currentWidth}
          step={0.5}
          onCommit={(v) =>
            onUpdate({
              style_overrides: {
                ...inst.style_overrides,
                line: { ...inst.style_overrides?.line, type: 'solid', width: Math.max(0.5, v) },
              },
            })
          }
        />
      </Row>
    </Section>
  );
}

// ─────────────────────────────────────────────────────────
// 通用控件
// ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={styles.row}>{children}</div>;
}

/** 数值输入 — Enter 或失焦提交,避免每次 keypress 触发重渲染 */
function NumField(props: { label: string; value: number; step?: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatNum(props.value));
  // 同步外部 value 变化(选不同节点时)
  useEffect(() => setText(formatNum(props.value)), [props.value]);

  const commit = () => {
    const v = parseFloat(text);
    if (!Number.isNaN(v) && v !== props.value) {
      props.onCommit(v);
    } else {
      setText(formatNum(props.value));   // 还原显示
    }
  };

  return (
    <label style={styles.fieldLabel}>
      <span style={styles.fieldLabelText}>{props.label}</span>
      <input
        type="number"
        step={props.step ?? 1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(formatNum(props.value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={styles.fieldInput}
      />
    </label>
  );
}

function ColorField(props: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <label style={styles.fieldLabel}>
      <span style={styles.fieldLabelText}>{props.label}</span>
      <span style={styles.colorWrap}>
        <input
          type="color"
          value={normalizeHex(props.value)}
          onChange={(e) => props.onChange(e.target.value)}
          style={styles.colorInput}
        />
        <input
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          style={{ ...styles.fieldInput, flex: 1 }}
        />
      </span>
    </label>
  );
}

// ─────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────

function formatNum(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

/** color input 只接受 #RRGGBB 格式;其他形式(rgba/named)用 fallback */
function normalizeHex(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return '#4A90E2';
}

interface PanelPos {
  left?: number;
  top?: number;
  right?: number;
}

function loadPos(): PanelPos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    }
  } catch {
    // ignore
  }
  return DEFAULT_POS;
}

function resolvePosStyle(pos: PanelPos): CSSProperties {
  // 三选二:left/right + top
  const top = pos.top ?? 60;
  if (pos.left !== undefined) return { left: pos.left, top };
  if (pos.right !== undefined) return { right: pos.right, top };
  return { right: 12, top };
}

// ─────────────────────────────────────────────────────────
// styles
// ─────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  panel: {
    position: 'fixed',
    zIndex: 800,
    width: PANEL_W,
    background: 'rgba(40, 40, 40, 0.95)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    color: 'var(--krig-text-primary)',
    overflow: 'hidden',
    fontSize: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 28,
    padding: '0 10px',
    background: 'rgba(255, 255, 255, 0.04)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    cursor: 'move',
    userSelect: 'none' as const,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: 500,
    flex: 1,
  },
  headerCloseBtn: {
    width: 18,
    height: 18,
    background: 'transparent',
    border: 'none',
    color: 'var(--krig-text-dim)',
    fontSize: 16,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 3,
  },
  body: {
    padding: 10,
    maxHeight: 'calc(100vh - 120px)',
    overflowY: 'auto',
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 10,
    color: 'var(--krig-text-dim)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 6,
  },
  row: {
    display: 'flex',
    gap: 6,
    marginBottom: 4,
  },
  fieldLabel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  fieldLabelText: {
    fontSize: 10,
    color: 'var(--krig-text-muted)',
  },
  fieldInput: {
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 4,
    padding: '4px 6px',
    color: 'var(--krig-text-primary)',
    fontSize: 12,
    width: '100%',
    outline: 'none',
    boxSizing: 'border-box',
  },
  colorWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  colorInput: {
    width: 28,
    height: 24,
    padding: 0,
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 4,
    background: 'transparent',
    cursor: 'pointer',
  },
  multiHint: {
    fontSize: 11,
    color: 'var(--krig-text-muted)',
    lineHeight: 1.6,
    marginBottom: 12,
  },
  combineBtn: {
    width: '100%',
    background: 'var(--krig-accent-bg)',
    border: '1px solid var(--krig-accent-border)',
    borderRadius: 4,
    color: '#fff',
    fontSize: 12,
    height: 28,
    cursor: 'pointer',
  },
};

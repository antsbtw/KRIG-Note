/**
 * Inspector 共享 widget — Tab 内通用控件（B4.2.b 抽取）。
 *
 * 提供：
 *   NumberInput   数字输入框（Enter 提交、Esc 取消、blur 自动提交）
 *   ColorInput    颜色选择器（色块 + HTML5 color picker + Hex 文本）
 *   SegButton     分段按钮（active 高亮）
 *   SegRow        一组 SegButton 横排
 */
import { useEffect, useRef, useState } from 'react';

// ── NumberInput ──

export interface NumberInputProps {
  value: string;
  onCommit: (value: string) => void;
  /** 仅允许整数？默认 false（允许小数） */
  integer?: boolean;
  /** 占位符（value 为空时显示） */
  placeholder?: string;
}

export function NumberInput({ value, onCommit, integer, placeholder }: NumberInputProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  // 外部 value 变化时同步 draft（仅当输入框未聚焦）
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      setDraft(value);
    }
  }, [value]);

  const pattern = integer ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
  const commit = () => {
    if (draft === value) return;
    if (!pattern.test(draft)) {
      setDraft(value);
      return;
    }
    onCommit(draft);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      placeholder={placeholder}
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

// ── ColorInput ──

export interface ColorInputProps {
  /** 当前值（'#rrggbb' 或 'mixed' 或 undefined） */
  value: string | undefined;
  onCommit: (value: string) => void;
  /** 显示 'Mixed' 而不是 value（多选混合态） */
  mixed?: boolean;
}

export function ColorInput({ value, onCommit, mixed }: ColorInputProps) {
  // 默认值：value 是合法 hex 才用，否则 fallback 黑
  const hex = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  const [draft, setDraft] = useState(hex);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current && document.activeElement !== inputRef.current) {
      setDraft(hex);
    }
  }, [hex]);

  const commitHex = (v: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
      setDraft(hex);
      return;
    }
    if (v === value) return;
    onCommit(v);
  };

  return (
    <span style={colorRowStyle}>
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          setDraft(e.target.value);
          onCommit(e.target.value);
        }}
        style={colorPickerStyle}
        title="点击选色"
      />
      <input
        ref={inputRef}
        type="text"
        value={mixed ? 'Mixed' : draft}
        placeholder="#rrggbb"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commitHex(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(hex);
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{
          ...inputStyle,
          flex: 1,
          marginLeft: 4,
          fontFamily: 'monospace',
          fontSize: 11,
          color: mixed ? '#666' : '#e8eaed',
        }}
      />
    </span>
  );
}

// ── SegButton + SegRow ──

export function SegRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 4 }}>{children}</div>;
}

export function SegButton({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        ...segButtonStyle,
        ...(active ? segButtonActiveStyle : {}),
      }}
    >
      {children}
    </button>
  );
}

// ── 样式 ──

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

const colorRowStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  width: '100%',
};

const colorPickerStyle: React.CSSProperties = {
  width: 24,
  height: 22,
  border: '1px solid #333',
  borderRadius: 3,
  background: 'transparent',
  cursor: 'pointer',
  padding: 0,
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

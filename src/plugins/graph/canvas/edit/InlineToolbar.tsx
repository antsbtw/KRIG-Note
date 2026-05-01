/**
 * InlineToolbar — 画板文字编辑态选区浮工具栏(M2.1.5)
 *
 * 选区非空时浮出,提供 mark 切换 + 行内公式插入快捷入口.
 *
 * 与 NoteView FloatingToolbar 的关系:
 * - 画板节点尺寸通常较小,UI 精简到 6 个核心按钮
 * - 不接颜色 / 字号 / 高亮(NoteView 高级字段,M3 之后通过浮条进 Inspector 提供)
 * - 链接走简化输入(prompt),NoteView 完整三 Tab 链接面板留 v1.x
 *
 * 字段(对齐 spec §4.5):
 *   B / I / U / <> (code) / ∑ (math inline) / 🔗 (link)
 *
 * 触发:
 *   - 选区非空 + 不在 mathInline / mathBlock 内 → 显示
 *   - 选区为空 / 编辑器失焦 → 隐藏
 *
 * 实现:
 *   - 用 React + portal 挂到 EditOverlay popup 内部(避免被 popup 边界裁剪)
 *   - 监听 EditorView 的 transactions,selection 变化时更新位置
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { MarkType } from 'prosemirror-model';
import { toggleMark } from 'prosemirror-commands';
import { setTextAlign, applyLink, removeLink } from '../../../note/commands/editor-commands';
import { ColorPicker } from '../../../note/components/ColorPicker';
import { LinkPanel } from '../../../note/components/LinkPanel';
import {
  IconAlignLeft, IconAlignCenter, IconAlignRight, IconTextColor,
} from '../../../note/components/icons';

interface InlineToolbarProps {
  view: EditorView | null;
}

/** 检测当前选区上 mark 是否激活(active 高亮按钮) */
function isMarkActive(view: EditorView, markType: MarkType | undefined): boolean {
  if (!markType) return false;
  const { from, $from, to, empty } = view.state.selection;
  if (empty) return !!markType.isInSet(view.state.storedMarks || $from.marks());
  return view.state.doc.rangeHasMark(from, to, markType);
}

/** 是否在 mathInline / mathBlock 等 atom 节点内(此时不显工具栏) */
function isInAtomNode(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.spec.atom) return true;
  }
  return false;
}

/** 取选区上 link mark 的 href(无则 null);用于 LinkPanel currentHref */
function getActiveLinkHref(view: EditorView): string | null {
  const { from, to } = view.state.selection;
  const linkType = view.state.schema.marks.link;
  if (!linkType) return null;
  let href: string | null = null;
  view.state.doc.nodesBetween(from, to, (node) => {
    const linkMark = linkType.isInSet(node.marks);
    if (linkMark) href = linkMark.attrs.href as string;
  });
  return href;
}

/** 找到当前选区所在的 textBlock(pos + node);非 textBlock 内返回 null */
function findCurrentTextBlock(view: EditorView): { pos: number; align: string } | null {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type.name === 'textBlock') {
      return {
        pos: $from.before(d),
        align: (node.attrs.align as string) ?? 'left',
      };
    }
  }
  return null;
}

export function InlineToolbar({ view }: InlineToolbarProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [showColor, setShowColor] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [lastTextColor, setLastTextColor] = useState('');
  const [lastBgColor, setLastBgColor] = useState('');
  // forceUpdate trigger:transaction 后重新检查 mark active 态
  const [, forceUpdate] = useState(0);
  const tbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!view) {
      setVisible(false);
      return;
    }

    const updateState = () => {
      if (!view || view.isDestroyed) return;
      const { from, to } = view.state.selection;
      // 选区为空 → 隐藏
      if (from === to) {
        setVisible(false);
        return;
      }
      // 在 atom 节点内(如 mathInline)→ 隐藏
      if (isInAtomNode(view)) {
        setVisible(false);
        return;
      }
      // 计算位置:选区上方 + 8px 间距
      try {
        const fromCoords = view.coordsAtPos(from);
        const toCoords = view.coordsAtPos(to);
        const centerX = (fromCoords.left + toCoords.left) / 2;
        const top = Math.min(fromCoords.top, toCoords.top) - 8;
        setPos({ top, left: centerX });
        setVisible(true);
        forceUpdate((n) => n + 1);
      } catch {
        setVisible(false);
      }
    };

    // 用轮询代替 monkey-patch view.dispatch:
    // - 简单 / 不影响 PM 内部状态
    // - 无需在 destroy 时还原任何东西
    // - 16ms 间隔人眼无感(60fps);CPU 开销可忽略(只读 view.state.selection)
    const timer = window.setInterval(updateState, 16);

    // 初次也跑一次
    updateState();

    // 失焦隐藏
    const onBlur = () => setVisible(false);
    view.dom.addEventListener('blur', onBlur);

    return () => {
      window.clearInterval(timer);
      view.dom.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  if (!view || !visible) return null;

  const { schema } = view.state;
  const items = [
    { id: 'bold', label: <b>B</b>, mark: schema.marks.bold, title: 'Bold (⌘B)' },
    { id: 'italic', label: <i>I</i>, mark: schema.marks.italic, title: 'Italic (⌘I)' },
    { id: 'underline', label: <u>U</u>, mark: schema.marks.underline, title: 'Underline (⌘U)' },
    { id: 'code', label: '< >', mark: schema.marks.code, title: 'Code (⌘E)' },
  ].filter((i) => i.mark !== undefined);

  return (
    <div
      ref={tbRef}
      // 不让 mousedown 抢走选区(否则点按钮选区丢失)
      onMouseDown={(e) => e.preventDefault()}
      style={{
        ...styles.toolbar,
        top: pos.top,
        left: pos.left,
      }}
    >
      {items.map((item) => {
        const active = isMarkActive(view, item.mark);
        return (
          <button
            key={item.id}
            type="button"
            title={item.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              if (item.mark) {
                const cmd = toggleMark(item.mark);
                cmd(view.state, view.dispatch);
                view.focus();
              }
            }}
            style={{ ...styles.btn, ...(active ? styles.btnActive : null) }}
          >
            {item.label}
          </button>
        );
      })}

      {/* 对齐:左 / 中 / 右(段级 attrs,改 textBlock.attrs.align)— icons 复用 NoteView.
          多行选中时 align 应用到选区覆盖的所有 textBlock(走 setTextAlign(view, null, ...)). */}
      {(() => {
        const tb = findCurrentTextBlock(view);
        if (!tb) return null;
        const apply = (align: string) => {
          setTextAlign(view, null, align);
          view.focus();
        };
        const alignBtn = (id: string, glyph: ReactNode, title: string) => (
          <button
            key={id}
            type="button"
            title={title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.preventDefault();
              apply(id);
            }}
            style={{ ...styles.btn, ...(tb.align === id ? styles.btnActive : null) }}
          >
            {glyph}
          </button>
        );
        return (
          <>
            {alignBtn('left', IconAlignLeft, 'Align left')}
            {alignBtn('center', IconAlignCenter, 'Align center')}
            {alignBtn('right', IconAlignRight, 'Align right')}
            <span style={styles.divider} />
          </>
        );
      })()}

      {/* ∑ 行内公式:把选区文字 → mathInline 节点(NoteView schema 用 attrs.latex)*/}
      {schema.nodes.mathInline && (
        <button
          type="button"
          title="Math Inline (selection → LaTeX)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            const { state, dispatch } = view;
            const { from, to, empty } = state.selection;
            if (empty) return;
            const latex = state.doc.textBetween(from, to, ' ', ' ').trim();
            if (!latex) return;
            const node = schema.nodes.mathInline.create({ latex });
            dispatch(state.tr.replaceSelectionWith(node));
            view.focus();
          }}
          style={styles.btn}
        >
          ∑
        </button>
      )}

      {/* A 颜色:打开 ColorPicker(文字颜色 + 高亮背景)— icon 复用 NoteView */}
      {(schema.marks.textStyle || schema.marks.highlight) && (
        <button
          type="button"
          title="Text color / highlight"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            setShowColor((v) => !v);
          }}
          style={{ ...styles.btn, ...(showColor ? styles.btnActive : null) }}
        >
          <IconTextColor lastColor={lastTextColor || '#8ab4f8'} />
        </button>
      )}

      {/* 🔗 链接:打开 LinkPanel(三 Tab,与 NoteView FloatingToolbar 共享组件) */}
      {schema.marks.link && (
        <button
          type="button"
          title="Add link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            setShowLink((v) => !v);
            setShowColor(false);
          }}
          style={{ ...styles.btn, ...(showLink ? styles.btnActive : null) }}
        >
          🔗
        </button>
      )}

      {/* ColorPicker 浮层(在 toolbar 下方;复用 NoteView 组件)*/}
      {showColor && (
        <div style={styles.colorPickerWrap}>
          <ColorPicker
            view={view}
            onClose={() => setShowColor(false)}
            onTextColorApplied={(c) => setLastTextColor(c)}
            onHighlightApplied={(c) => setLastBgColor(c)}
            lastTextColor={lastTextColor}
            lastBgColor={lastBgColor}
          />
        </div>
      )}

      {/* LinkPanel 浮层(三 Tab:笔记 / 文件 / 网页;复用 NoteView 组件)*/}
      {showLink && (
        <div style={styles.colorPickerWrap}>
          <LinkPanel
            view={view}
            currentHref={getActiveLinkHref(view)}
            onApply={(href) => {
              applyLink(view, href);
              setShowLink(false);
              view.focus();
            }}
            onRemove={() => {
              removeLink(view);
              setShowLink(false);
              view.focus();
            }}
            onClose={() => {
              setShowLink(false);
              view.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  toolbar: {
    position: 'fixed',
    transform: 'translate(-50%, -100%)',
    zIndex: 1100,
    display: 'flex',
    gap: 2,
    padding: 4,
    background: 'rgba(40, 44, 52, 0.98)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    fontSize: 13,
    userSelect: 'none',
  },
  btn: {
    minWidth: 24,
    height: 24,
    padding: '0 6px',
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: '#e0e0e0',
    cursor: 'pointer',
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    background: 'rgba(74, 144, 226, 0.4)',
    color: '#fff',
  },
  divider: {
    width: 1,
    height: 16,
    margin: '0 4px',
    background: 'rgba(255, 255, 255, 0.15)',
  },
  colorPickerWrap: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    zIndex: 1110,
  },
};

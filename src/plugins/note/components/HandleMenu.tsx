import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import {
  IconAlignLeft, IconAlignCenter, IconAlignRight,
  IconIndentLeft, IconIndentRight,
} from './icons';
import { blockRegistry } from '../registry';
import { toggleHeadingCollapse } from '../plugins/heading-collapse';
import { openAskAIPanel } from './AskAIPanel';
import { setTextBlockLevel } from '../commands/set-text-block-level';
import { deleteBlockAt, applyTextColor as applyTextColorCmd, applyHighlight as applyHighlightCmd, toggleTextIndent as toggleTextIndentCmd, setTextAlign as setTextAlignCmd, indentBlockAt, outdentBlockAt } from '../commands/editor-commands';
import { addThought } from '../commands/thought-commands';
import { addBlockFrame, updateBlockFrameColor, updateBlockFrameStyle, removeBlockFrame } from '../commands/frame-commands';
import { FramePicker } from './FramePicker';
import { getCurrentNoteId } from '../plugins/link-click';

/**
 * HandleMenu — 手柄点击后的操作菜单
 *
 * 一级菜单：Turn Into / Color / Copy / Delete
 * Turn Into → 二级子菜单（文本类 block 转换）
 * Color → 二级子菜单（文字颜色 + 背景颜色）
 */

interface HandleMenuProps {
  view: EditorView | null;
}

interface MenuState {
  pos: number;
  blockType: string;
  coords: { left: number; top: number };
}

type SubMenu = 'turnInto' | 'color' | 'format' | 'frame' | null;

// ── 颜色定义（复用 ColorPicker） ──

const TEXT_COLORS = [
  { name: 'Default', color: '' },
  { name: 'Gray', color: '#9aa0a6' },
  { name: 'Brown', color: '#a67c52' },
  { name: 'Orange', color: '#f29900' },
  { name: 'Yellow', color: '#f5c518' },
  { name: 'Green', color: '#34a853' },
  { name: 'Blue', color: '#8ab4f8' },
  { name: 'Purple', color: '#c58af9' },
  { name: 'Pink', color: '#f48fb1' },
  { name: 'Red', color: '#ea4335' },
];

const BG_COLORS = [
  { name: 'Default', color: '' },
  { name: 'Gray', color: 'rgba(154, 160, 166, 0.2)' },
  { name: 'Brown', color: 'rgba(166, 124, 82, 0.2)' },
  { name: 'Orange', color: 'rgba(242, 153, 0, 0.2)' },
  { name: 'Yellow', color: 'rgba(245, 197, 24, 0.2)' },
  { name: 'Green', color: 'rgba(52, 168, 83, 0.2)' },
  { name: 'Blue', color: 'rgba(138, 180, 248, 0.2)' },
  { name: 'Purple', color: 'rgba(197, 138, 249, 0.2)' },
  { name: 'Pink', color: 'rgba(244, 143, 177, 0.2)' },
  { name: 'Red', color: 'rgba(234, 67, 53, 0.2)' },
];

// Turn Into 排除的 group（媒体类不适合转换）
const EXCLUDED_GROUPS = new Set(['media']);
// Turn Into 排除的 block（column 变体、mermaid 等不适合从手柄转换）
const EXCLUDED_IDS = new Set(['column3', 'mermaid', 'mathInline']);

/** 获取 Turn Into 可用的目标列表 */
function getTurnIntoItems() {
  return blockRegistry.getSlashItems()
    .filter(item => !EXCLUDED_GROUPS.has(item.group) && !EXCLUDED_IDS.has(item.id))
    .sort((a, b) => {
      // basic 优先，然后 layout，然后其他
      const groupOrder: Record<string, number> = { basic: 0, layout: 1, code: 2 };
      const ga = groupOrder[a.group] ?? 99;
      const gb = groupOrder[b.group] ?? 99;
      if (ga !== gb) return ga - gb;
      return a.order - b.order;
    });
}

const VIEWPORT_PAD = 8;

export function HandleMenu({ view }: HandleMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [subMenu, setSubMenu] = useState<SubMenu>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!view) return;
    let closeListener: ((e: MouseEvent) => void) | null = null;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setMenu({ pos: detail.pos, blockType: detail.blockType, coords: detail.coords });
      setSubMenu(null);

      if (closeListener) document.removeEventListener('mousedown', closeListener);

      setTimeout(() => {
        closeListener = (me: MouseEvent) => {
          const menuEl = document.querySelector('.handle-menu');
          const subEl = document.querySelector('.handle-submenu');
          if (menuEl?.contains(me.target as Node)) return;
          if (subEl?.contains(me.target as Node)) return;
          setMenu(null);
          setSubMenu(null);
          if (closeListener) document.removeEventListener('mousedown', closeListener);
          closeListener = null;
        };
        document.addEventListener('mousedown', closeListener);
      }, 50);
    };

    view.dom.addEventListener('block-handle-click', handler);
    return () => {
      view.dom.removeEventListener('block-handle-click', handler);
      if (closeListener) document.removeEventListener('mousedown', closeListener);
    };
  }, [view]);

  // 主菜单边界矫正：coords.top 是 handle 底部；
  // 下方空间不够就把菜单底贴在 handle 底（向上展开），右侧不够就往左收。
  useLayoutEffect(() => {
    if (!menu) { setMenuPos(null); return; }
    const el = menuRef.current;
    if (!el) { setMenuPos(menu.coords); return; }
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { left, top } = menu.coords;
    if (top + rect.height > vh - VIEWPORT_PAD) top = menu.coords.top - rect.height;
    if (left + rect.width > vw - VIEWPORT_PAD) left = vw - rect.width - VIEWPORT_PAD;
    if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
    setMenuPos({ left, top });
  }, [menu]);

  // 子菜单切换时先清位置，避免新子菜单按旧 subPos 渲染一帧导致闪烁。
  useLayoutEffect(() => { setSubPos(null); }, [subMenu]);

  // 子菜单边界矫正：默认右侧，溢出则翻到左侧；底部溢出则向上收。
  useLayoutEffect(() => {
    if (!subMenu || !menuPos) { setSubPos(null); return; }
    const mainEl = menuRef.current;
    const subEl = subMenuRef.current;
    if (!mainEl || !subEl) return;
    const mainRect = mainEl.getBoundingClientRect();
    const subRect = subEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = mainRect.right + 4;
    let top = mainRect.top;
    if (left + subRect.width > vw - VIEWPORT_PAD) left = mainRect.left - subRect.width - 4;
    if (top + subRect.height > vh - VIEWPORT_PAD) top = vh - subRect.height - VIEWPORT_PAD;
    if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
    setSubPos({ left, top });
  }, [subMenu, menuPos]);

  if (!menu || !view) return null;

  const close = () => { setMenu(null); setSubMenu(null); };

  // ── 操作函数 ──

  const deleteBlock = () => {
    deleteBlockAt(view, menu.pos);
    close();
  };

  const copyBlock = () => {
    const node = view.state.doc.nodeAt(menu.pos);
    if (node) {
      const text = node.textContent;
      if (text) navigator.clipboard.writeText(text);
    }
    close();
  };

  const copyBlockLink = () => {
    const noteId = getCurrentNoteId();
    const node = view.state.doc.nodeAt(menu.pos);
    if (!noteId || !node) { close(); return; }
    // 标题 block：用标题文本（短且稳定）
    // 普通 block：用前 30 字符 + 顺序索引
    const text = node.textContent.trim();
    let anchor: string;
    if (node.type.name === 'textBlock' && node.attrs.level) {
      // 标题 — 直接用标题文本
      anchor = encodeURIComponent(text.slice(0, 60));
    } else {
      // 普通 block — 用顺序索引 + 前缀文本
      let idx = 0;
      view.state.doc.forEach((_n, _o, i) => { if (_o === menu.pos) idx = i; });
      const preview = text.slice(0, 30);
      anchor = `${idx}:${encodeURIComponent(preview)}`;
    }
    const link = `krig://block/${noteId}/${anchor}`;
    navigator.clipboard.writeText(link);
    close();
  };


  /** Turn Into: 把当前 block 转换为目标类型 */
  const turnInto = (item: { blockName: string; attrs?: Record<string, unknown> }) => {
    const node = view.state.doc.nodeAt(menu.pos);
    if (!node) { close(); return; }
    const schema = view.state.schema;

    // textBlock → textBlock（改 level）
    // 复用与键盘快捷键相同的命令，确保行为一致：在 orderedList 中转 heading 时
    // 会自动把节点提取出来、把序号作为普通文字注入。
    if (item.blockName === 'textBlock' && node.type.name === 'textBlock') {
      const level = (item.attrs?.level as number | null | undefined) ?? null;
      const tr = setTextBlockLevel(view.state, menu.pos, level);
      if (tr) view.dispatch(tr);
      close();
      return;
    }

    // textBlock（含 heading）→ 其他类型
    // 或 其他类型 → textBlock
    const nodeType = schema.nodes[item.blockName];
    if (!nodeType) { close(); return; }

    const blockDef = blockRegistry.get(item.blockName);
    const isContainer = blockDef?.containerRule !== undefined;
    const contentExpr = blockDef?.nodeSpec.content || '';
    const hasBlockContent = contentExpr.includes('block') || contentExpr.includes('Block');
    const isAtom = blockDef?.nodeSpec.atom;

    // 源是 inline* 容器（paragraph/heading/textBlock）时原样搬运 inline 节点，
    // 避免 atom（如 mathInline）被 textContent 降级为 `$...$` 字符串。
    // 源是块容器（callout/blockquote 等）时仍走 textContent —— 嵌套容器互转
    // 本就是信息压缩，保持既有行为。
    const sourceIsInlineContainer = node.type.spec.content === 'inline*';
    const inlineContent = sourceIsInlineContainer
      ? node.content
      : (node.textContent ? schema.text(node.textContent) : null);

    let newNode;

    if (item.blockName === 'textBlock') {
      // → textBlock: 保留 inline 内容
      newNode = inlineContent
        ? schema.nodes.textBlock.create(item.attrs ?? null, inlineContent)
        : schema.nodes.textBlock.create(item.attrs ?? null);
    } else if (item.blockName === 'taskList') {
      const nowISO = new Date().toISOString();
      const inner = inlineContent
        ? schema.nodes.textBlock.create(null, inlineContent)
        : schema.nodes.textBlock.create();
      const taskItem = schema.nodes.taskItem.create({ createdAt: nowISO }, [inner]);
      newNode = nodeType.create(null, [taskItem]);
    } else if (item.blockName === 'table') {
      const cell = () => schema.nodes.tableCell.create(null, [schema.nodes.textBlock.create()]);
      const header = () => schema.nodes.tableHeader.create(null, [schema.nodes.textBlock.create()]);
      newNode = nodeType.create(null, [
        schema.nodes.tableRow.create(null, [header(), header(), header()]),
        schema.nodes.tableRow.create(null, [cell(), cell(), cell()]),
        schema.nodes.tableRow.create(null, [cell(), cell(), cell()]),
      ]);
    } else if (item.blockName === 'columnList') {
      const colCount = (item.attrs?.columns as number) || 2;
      const columns = [];
      const firstContent = inlineContent
        ? [schema.nodes.textBlock.create(null, inlineContent)]
        : [schema.nodes.textBlock.create()];
      columns.push(schema.nodes.column.create(null, firstContent));
      for (let i = 1; i < colCount; i++) {
        columns.push(schema.nodes.column.create(null, [schema.nodes.textBlock.create()]));
      }
      newNode = nodeType.create({ columns: colCount }, columns);
    } else if (item.blockName === 'mathBlock') {
      // mathBlock 目标是 text*，但 textContent 会把 mathInline atom 通过 leafText
      // 降级成 `$latex$`（带美元号），塞进 mathBlock 后 KaTeX 拒绝解析，显示红色源码。
      // 因此单独走一条：遍历源 inline，mathInline 取裸 attrs.latex，text 取 .text。
      let latex = '';
      if (sourceIsInlineContainer) {
        node.content.forEach((child) => {
          if (child.type.name === 'mathInline') {
            latex += (child.attrs.latex as string) ?? '';
          } else if (child.isText) {
            latex += child.text ?? '';
          }
        });
      } else {
        latex = node.textContent;
      }
      newNode = latex
        ? nodeType.create(item.attrs ?? null, schema.text(latex))
        : nodeType.create(item.attrs ?? null);
    } else if (nodeType.spec.content === 'text*' || item.blockName === 'codeBlock') {
      // codeBlock 目标是 text*，只能装纯文本 —— 走 textContent 降维
      const text = node.textContent;
      newNode = text
        ? nodeType.create(item.attrs ?? null, schema.text(text))
        : nodeType.create(item.attrs ?? null);
    } else if (isAtom) {
      newNode = nodeType.create(item.attrs ?? null);
    } else if (isContainer || hasBlockContent) {
      const inner = inlineContent
        ? schema.nodes.textBlock.create(null, inlineContent)
        : schema.nodes.textBlock.create();
      newNode = nodeType.create(item.attrs ?? null, [inner]);
    } else {
      newNode = nodeType.create(item.attrs ?? null);
    }

    if (newNode) {
      const tr = view.state.tr.replaceWith(menu.pos, menu.pos + node.nodeSize, newNode);
      try {
        tr.setSelection(TextSelection.near(tr.doc.resolve(menu.pos + 1)));
      } catch {
        try { tr.setSelection(TextSelection.near(tr.doc.resolve(menu.pos + 2))); } catch { /* ok */ }
      }
      view.dispatch(tr);
    }
    close();
  };

  /** Color: 给整个 block 的文字设颜色 */
  const applyTextColor = (color: string) => {
    const node = view.state.doc.nodeAt(menu.pos);
    if (!node) return;
    if (node.type.name === 'mathBlock') {
      // mathBlock 禁用 marks（marks: ''），走 node attr 路径
      const tr = view.state.tr.setNodeMarkup(menu.pos, null, {
        ...node.attrs,
        color: color || null,
      });
      view.dispatch(tr);
      return;
    }
    applyTextColorCmd(view, menu.pos + 1, menu.pos + node.nodeSize - 1, color);
  };

  const applyBgColor = (color: string) => {
    const node = view.state.doc.nodeAt(menu.pos);
    if (!node) return;
    if (node.type.name === 'mathBlock') {
      const tr = view.state.tr.setNodeMarkup(menu.pos, null, {
        ...node.attrs,
        bgColor: color || null,
      });
      view.dispatch(tr);
      return;
    }
    applyHighlightCmd(view, menu.pos + 1, menu.pos + node.nodeSize - 1, color);
  };

  // ── 子菜单位置 ──
  // 初次渲染用主菜单右侧的估算位置让 useLayoutEffect 能测量，
  // 测量后由 subPos 接管并矫正到视口内。
  const getSubMenuStyle = (): React.CSSProperties => {
    const base: React.CSSProperties = {
      position: 'fixed',
      zIndex: 1001,
      background: '#2a2a2a',
      border: '1px solid #444',
      borderRadius: '8px',
      padding: '4px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    };
    if (subPos) {
      base.left = subPos.left;
      base.top = subPos.top;
    } else if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      base.left = rect.right + 4;
      base.top = rect.top;
      base.visibility = 'hidden';
    }
    return base;
  };

  // ── Turn Into 子菜单 ──
  const turnIntoItems = getTurnIntoItems();

  // 按 group 分组，插入分隔线
  const renderTurnIntoItems = () => {
    const result: React.ReactElement[] = [];
    let lastGroup = '';
    for (const item of turnIntoItems) {
      if (lastGroup && item.group !== lastGroup) {
        result.push(<div key={`sep-${item.id}`} style={styles.separator} />);
      }
      lastGroup = item.group;
      result.push(
        <div
          key={item.id}
          style={styles.item}
          onMouseDown={(e) => { e.preventDefault(); turnInto(item); }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={styles.icon}>{item.icon}</span>
          <span>{item.label}</span>
        </div>,
      );
    }
    return result;
  };

  // ── 渲染 ──

  return (
    <>
      {/* 一级菜单 */}
      <div
        ref={menuRef}
        className="handle-menu"
        style={{
          ...styles.container,
          left: menuPos?.left ?? menu.coords.left,
          top: menuPos?.top ?? menu.coords.top,
          // 测量完成前先隐藏，避免用户看到位置跳变
          visibility: menuPos ? 'visible' : 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Turn Into */}
        <div
          style={styles.item}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu('turnInto'); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.icon}>↔</span>
          <span style={{ flex: 1 }}>Turn Into</span>
          <span style={styles.arrow}>▸</span>
        </div>

        {/* Color */}
        <div
          style={styles.item}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu('color'); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.icon}>🎨</span>
          <span style={{ flex: 1 }}>Color</span>
          <span style={styles.arrow}>▸</span>
        </div>

        {/* Frame — 框定 */}
        <div
          style={styles.item}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu('frame'); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.icon}>▣</span>
          <span style={{ flex: 1 }}>
            {(() => {
              const node = view.state.doc.nodeAt(menu.pos);
              return node?.attrs.frameColor ? '修改框定' : '框定';
            })()}
          </span>
          <span style={styles.arrow}>▸</span>
        </div>

        {/* Format — for blocks with indent attr (title excluded) */}
        {(() => {
          const node = view.state.doc.nodeAt(menu.pos);
          if (!node || node.attrs.indent === undefined || node.attrs.isTitle) return null;
          return (
            <div
              style={styles.item}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu('format'); }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={styles.icon}>¶</span>
              <span style={{ flex: 1 }}>Format</span>
              <span style={styles.arrow}>▸</span>
            </div>
          );
        })()}

        {/* Collapse/Expand — only for headings */}
        {(() => {
          const node = view.state.doc.nodeAt(menu.pos);
          if (node?.type.name === 'textBlock' && node.attrs.level) {
            const isOpen = node.attrs.open !== false;
            return (
              <div
                style={styles.item}
                onMouseDown={(e) => {
                  e.preventDefault();
                  toggleHeadingCollapse(view, menu.pos);
                  close();
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu(null); }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={styles.icon}>{isOpen ? '⌃' : '⌄'}</span>
                <span>{isOpen ? '折叠' : '展开'}</span>
              </div>
            );
          }
          return null;
        })()}

        <div style={styles.separator} />

        {/* Copy */}
        <div
          style={styles.item}
          onMouseDown={(e) => { e.preventDefault(); copyBlock(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu(null); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.icon}>📋</span>
          <span>Copy</span>
        </div>

        {/* Copy Link */}
        <div
          style={styles.item}
          onMouseDown={(e) => { e.preventDefault(); copyBlockLink(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu(null); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.icon}>🔗</span>
          <span>Copy Link</span>
        </div>

        {/* Thought — 一键添加标注（默认"思考"类型） */}
        <div
          style={styles.item}
          onMouseDown={(e) => {
            e.preventDefault();
            // 选中当前 block 再 addThought
            const node = view.state.doc.nodeAt(menu.pos);
            if (node) {
              try {
                const tr = view.state.tr.setSelection(
                  TextSelection.create(view.state.doc, menu.pos + 1, menu.pos + node.nodeSize - 1),
                );
                view.dispatch(tr);
              } catch { /* ok */ }
            }
            addThought(view);
            close();
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu(null); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.icon}>💭</span>
          <span>Thought</span>
        </div>

        {/* Ask AI — 收起菜单，弹出独立浮窗 */}
        <div
          style={styles.item}
          onMouseDown={(e) => {
            e.preventDefault();
            const coords = menu.coords;
            close();
            openAskAIPanel(view, coords);
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu(null); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.icon}>🤖</span>
          <span>Ask AI</span>
        </div>

        <div style={styles.separator} />

        {/* Delete */}
        <div
          style={styles.item}
          onMouseDown={(e) => { e.preventDefault(); deleteBlock(); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenu(null); }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={styles.icon}>🗑</span>
          <span>Delete</span>
        </div>
      </div>

      {/* Turn Into 子菜单 */}
      {subMenu === 'turnInto' && (
        <div
          ref={subMenuRef}
          className="handle-submenu"
          style={{ ...getSubMenuStyle(), minWidth: '180px', maxHeight: '360px', overflowY: 'auto' }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setSubMenu('turnInto')}
        >
          {renderTurnIntoItems()}
        </div>
      )}

      {/* Color 子菜单 */}
      {subMenu === 'color' && (
        <div
          ref={subMenuRef}
          className="handle-submenu"
          style={{ ...getSubMenuStyle(), minWidth: '220px', padding: '8px 10px' }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setSubMenu('color')}
        >
          <div style={styles.sectionLabel}>文字颜色</div>
          <div style={styles.colorGrid}>
            {TEXT_COLORS.map((c) => (
              <button
                key={`t-${c.name}`}
                className="color-picker__swatch"
                style={{ background: c.color || '#e8eaed', width: 22, height: 22, borderRadius: 4, border: '2px solid transparent', cursor: 'pointer' }}
                title={c.name}
                onMouseDown={(e) => { e.preventDefault(); applyTextColor(c.color); }}
              />
            ))}
          </div>
          <div style={{ ...styles.sectionLabel, marginTop: 8 }}>背景颜色</div>
          <div style={styles.colorGrid}>
            {BG_COLORS.map((c) => (
              <button
                key={`b-${c.name}`}
                className="color-picker__swatch"
                style={{ background: c.color || '#3a3a3a', width: 22, height: 22, borderRadius: 4, border: '2px solid transparent', cursor: 'pointer' }}
                title={c.name}
                onMouseDown={(e) => { e.preventDefault(); applyBgColor(c.color); }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Format 子菜单 */}
      {subMenu === 'format' && (
        <div
          ref={subMenuRef}
          className="handle-submenu"
          style={{ ...getSubMenuStyle(), minWidth: '180px' }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setSubMenu('format')}
        >
          {(() => {
            const node = view.state.doc.nodeAt(menu.pos);
            const currentIndent = node?.attrs.textIndent ?? false;
            const currentAlign = node?.attrs.align ?? 'left';

            const currentBlockIndent = node?.attrs.indent || 0;

            const toggleTextIndent = () => {
              toggleTextIndentCmd(view, menu.pos);
              close();
            };

            const setAlign = (value: string) => {
              setTextAlignCmd(view, menu.pos, value);
              close();
            };

            return (
              <>
                {/* Block Indent（布局缩进） */}
                <div style={{ display: 'flex', gap: '2px', padding: '4px 8px' }}>
                  <div
                    style={{ ...styles.item, flex: 1, justifyContent: 'center', opacity: currentBlockIndent >= 8 ? 0.3 : 1 }}
                    onMouseDown={(e) => { e.preventDefault(); indentBlockAt(view, menu.pos); close(); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    title="Indent (Tab)"
                  >
                    <span style={styles.icon}>{IconIndentRight}</span>
                    <span>Indent</span>
                  </div>
                  <div
                    style={{ ...styles.item, flex: 1, justifyContent: 'center', opacity: currentBlockIndent <= 0 ? 0.3 : 1 }}
                    onMouseDown={(e) => { e.preventDefault(); outdentBlockAt(view, menu.pos); close(); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    title="Outdent (Shift+Tab)"
                  >
                    <span style={styles.icon}>{IconIndentLeft}</span>
                    <span>Outdent</span>
                  </div>
                </div>
                {/* Text Indent + Align — only for textBlock */}
                {node?.type.name === 'textBlock' && (
                  <>
                    <div style={styles.separator} />
                    <div
                      style={{ ...styles.item, ...(currentIndent ? { background: '#3a3a3a' } : {}) }}
                      onMouseDown={(e) => { e.preventDefault(); toggleTextIndent(); }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = currentIndent ? '#3a3a3a' : 'transparent'; }}
                    >
                      <span style={styles.icon}>⇥</span>
                      <span style={{ flex: 1 }}>Text Indent</span>
                      <span style={{ fontSize: 11, color: '#888' }}>⇧⌘I</span>
                    </div>
                    <div style={styles.separator} />
                  </>
                )}
                {node?.type.name === 'textBlock' && ([
                  // icons 复用 components/icons.tsx 中的共享 SVG(画板 InlineToolbar 也用同一份)
                  ['left', 'Align Left', IconAlignLeft],
                  ['center', 'Align Center', IconAlignCenter],
                  ['right', 'Align Right', IconAlignRight],
                ] as const).map(([value, label, icon]) => (
                  <div
                    key={value}
                    style={{ ...styles.item, ...(currentAlign === value ? { background: '#3a3a3a' } : {}) }}
                    onMouseDown={(e) => { e.preventDefault(); setAlign(value); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = currentAlign === value ? '#3a3a3a' : 'transparent'; }}
                  >
                    <span style={styles.icon}>{icon}</span>
                    <span>{label}</span>
                  </div>
                ))
                }
              </>
            );
          })()}
        </div>
      )}

      {/* Frame 框定子菜单 */}
      {subMenu === 'frame' && (
        <div
          ref={subMenuRef}
          className="handle-submenu"
          style={{ ...getSubMenuStyle(), minWidth: '200px' }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => setSubMenu('frame')}
        >
          {(() => {
            const node = view.state.doc.nodeAt(menu.pos);
            const hasFrame = !!node?.attrs.frameColor;

            return (
              <FramePicker
                currentColor={node?.attrs.frameColor || null}
                currentStyle={node?.attrs.frameStyle || null}
                onColorSelect={(color) => {
                  if (hasFrame) {
                    updateBlockFrameColor(view, menu.pos, color);
                  } else {
                    addBlockFrame(view, menu.pos, color, 'solid');
                  }
                }}
                onStyleSelect={(style) => {
                  if (hasFrame) {
                    updateBlockFrameStyle(view, menu.pos, style);
                  }
                }}
                onRemove={() => {
                  removeBlockFrame(view, menu.pos);
                  close();
                }}
                showRemove={hasFrame}
              />
            );
          })()}
        </div>
      )}

    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed', zIndex: 1000,
    background: '#2a2a2a', border: '1px solid #444', borderRadius: '8px',
    padding: '4px', minWidth: '170px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
  },
  item: {
    display: 'flex', alignItems: 'center', padding: '6px 12px',
    borderRadius: '4px', cursor: 'pointer', fontSize: '14px', color: '#e8eaed',
  },
  icon: { width: '28px', textAlign: 'center' as const, marginRight: '8px', flexShrink: 0 },
  arrow: { fontSize: '10px', color: '#888', marginLeft: '4px' },
  separator: { height: '1px', background: '#444', margin: '4px 8px' },
  sectionLabel: { fontSize: 11, color: '#9aa0a6', margin: '4px 0', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  colorGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: '4px' },
};

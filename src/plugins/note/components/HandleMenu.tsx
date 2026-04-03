import { useState, useEffect } from 'react';
import type { EditorView } from 'prosemirror-view';
import { blockRegistry } from '../registry';
import { blockAction } from '../block-ops/block-action';

/**
 * HandleMenu — Block 操作菜单（两级结构）
 *
 * 第一级：转换成 →（子菜单）/ Fold / 删除
 * 第二级（转换成）：文本 / 标题1 / 标题2 / 标题3 / 代码 / 引用 / ...
 */

interface HandleMenuProps {
  view: EditorView | null;
}

interface MenuState {
  open: boolean;
  pos: number;
  blockType: string;
  coords: { left: number; top: number };
}

export function HandleMenu({ view }: HandleMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [subMenuOpen, setSubMenuOpen] = useState(false);
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);

  useEffect(() => {
    if (!view) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setMenu({
        open: true,
        pos: detail.pos,
        blockType: detail.blockType,
        coords: detail.coords,
      });
      setSubMenuOpen(false);
      setFormatMenuOpen(false);
    };

    view.dom.addEventListener('block-handle-click', handler);
    const closeHandler = () => { setMenu(null); setSubMenuOpen(false); setFormatMenuOpen(false); };
    document.addEventListener('click', closeHandler);

    return () => {
      view.dom.removeEventListener('block-handle-click', handler);
      document.removeEventListener('click', closeHandler);
    };
  }, [view]);

  if (!menu?.open || !view) return null;

  const blockDef = blockRegistry.get(menu.blockType);
  const capabilities = blockDef?.capabilities;
  const customActions = blockDef?.customActions ?? [];
  const currentNode = view.state.doc.nodeAt(menu.pos);

  // ── 构建转换成子菜单项 ──
  const turnIntoItems: { id: string; label: string; icon: string; active: boolean; action: () => void }[] = [];

  // 文本（paragraph）
  turnIntoItems.push({
    id: 'paragraph', label: '文本', icon: 'T',
    active: menu.blockType === 'paragraph',
    action: () => { blockAction.turnInto(view, menu.pos, 'paragraph'); setMenu(null); },
  });

  // 标题 1-3
  for (let level = 1; level <= 3; level++) {
    turnIntoItems.push({
      id: `heading${level}`, label: `标题 ${level}`, icon: `H${level}`,
      active: menu.blockType === 'heading' && currentNode?.attrs.level === level,
      action: () => { blockAction.turnInto(view, menu.pos, 'heading', { level }); setMenu(null); },
    });
  }

  // 代码
  turnIntoItems.push({
    id: 'codeBlock', label: '代码', icon: '</>',
    active: menu.blockType === 'codeBlock',
    action: () => { blockAction.turnInto(view, menu.pos, 'codeBlock'); setMenu(null); },
  });

  // 引用
  turnIntoItems.push({
    id: 'blockquote', label: '引用', icon: '66',
    active: menu.blockType === 'blockquote',
    action: () => { blockAction.turnInto(view, menu.pos, 'blockquote'); setMenu(null); },
  });

  // 折叠列表
  turnIntoItems.push({
    id: 'toggleList', label: '折叠列表', icon: '▸',
    active: menu.blockType === 'toggleList',
    action: () => { blockAction.turnInto(view, menu.pos, 'toggleList'); setMenu(null); },
  });

  // 项目符号列表
  turnIntoItems.push({
    id: 'bulletList', label: '项目符号列表', icon: '•',
    active: menu.blockType === 'bulletList',
    action: () => { blockAction.turnInto(view, menu.pos, 'bulletList'); setMenu(null); },
  });

  // 有序列表
  turnIntoItems.push({
    id: 'orderedList', label: '有序列表', icon: '1.',
    active: menu.blockType === 'orderedList',
    action: () => { blockAction.turnInto(view, menu.pos, 'orderedList'); setMenu(null); },
  });

  // 待办清单
  turnIntoItems.push({
    id: 'taskList', label: '待办清单', icon: '☐',
    active: menu.blockType === 'taskList',
    action: () => { blockAction.turnInto(view, menu.pos, 'taskList'); setMenu(null); },
  });

  // ── 构建第一级菜单 ──
  const hasTurnInto = capabilities?.turnInto && capabilities.turnInto.length > 0;

  return (
    <div
      style={{ ...styles.container, left: menu.coords.left, top: menu.coords.top + 4 }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* 转换成 → 子菜单（外层容器统一管理 hover） */}
      {hasTurnInto && (
        <div
          style={styles.turnIntoWrapper}
          onMouseEnter={() => { setSubMenuOpen(true); setFormatMenuOpen(false); }}
          onMouseLeave={() => setSubMenuOpen(false)}
        >
          <div style={styles.item}>
            <span style={styles.icon}>↺</span>
            <span style={styles.label}>转换成</span>
            <span style={styles.arrow}>›</span>
          </div>

          {/* 子菜单 */}
          {subMenuOpen && (
            <div style={styles.subMenu}>
              <div style={styles.subMenuPanel}>
                {turnIntoItems.map((item) => (
                  <div
                    key={item.id}
                    style={styles.item}
                    onMouseDown={(e) => { e.preventDefault(); item.action(); }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={styles.icon}>{item.icon}</span>
                    <span style={styles.label}>{item.label}</span>
                    {item.active && <span style={styles.check}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 格式 → 子菜单（paragraph / heading） */}
      {(menu.blockType === 'paragraph' || menu.blockType === 'heading') && currentNode && (
        <div
          style={styles.turnIntoWrapper}
          onMouseEnter={() => { setFormatMenuOpen(true); setSubMenuOpen(false); }}
          onMouseLeave={() => setFormatMenuOpen(false)}
        >
          <div style={styles.item}>
            <span style={styles.icon}>¶</span>
            <span style={styles.label}>格式</span>
            <span style={styles.arrow}>›</span>
          </div>

          {formatMenuOpen && (
            <div style={styles.subMenu}>
              <div style={styles.subMenuPanel}>
                {/* 首行缩进 */}
                {menu.blockType === 'paragraph' && (
                  <div
                    style={styles.item}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      const newVal = !currentNode.attrs.textIndent;
                      view.dispatch(view.state.tr.setNodeMarkup(menu.pos, undefined, { ...currentNode.attrs, textIndent: newVal }));
                      setMenu(null);
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={styles.icon}>⇥</span>
                    <span style={styles.label}>首行缩进</span>
                    {currentNode.attrs.textIndent && <span style={styles.check}>✓</span>}
                  </div>
                )}
                {/* 分隔线 */}
                {menu.blockType === 'paragraph' && <div style={styles.separator} />}
                {/* 对齐方式 */}
                {[
                  { id: 'left', label: '左对齐', icon: '⫷' },
                  { id: 'center', label: '居中', icon: '⫿' },
                  { id: 'right', label: '右对齐', icon: '⫸' },
                  { id: 'justify', label: '两端对齐', icon: '☰' },
                ].map((a) => (
                  <div
                    key={a.id}
                    style={styles.item}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      view.dispatch(view.state.tr.setNodeMarkup(menu.pos, undefined, { ...currentNode.attrs, align: a.id }));
                      setMenu(null);
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#3a3a3a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={styles.icon}>{a.icon}</span>
                    <span style={styles.label}>{a.label}</span>
                    {(currentNode.attrs.align || 'left') === a.id && <span style={styles.check}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fold/Unfold（heading 专属） */}
      {menu.blockType === 'heading' && currentNode && (
        <div
          style={styles.item}
          onMouseDown={(e) => {
            e.preventDefault();
            const isOpen = currentNode.attrs.open !== false;
            view.dispatch(
              view.state.tr.setNodeMarkup(menu.pos, undefined, {
                ...currentNode.attrs, open: !isOpen,
              }),
            );
            setMenu(null);
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenuOpen(false); }}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={styles.icon}>{currentNode.attrs.open !== false ? '▸' : '▾'}</span>
          <span style={styles.label}>{currentNode.attrs.open !== false ? 'Fold' : 'Unfold'}</span>
          <span style={styles.shortcut}>⌘.</span>
        </div>
      )}

      {/* Block 专有操作 */}
      {customActions.filter(a => !a.showIn || a.showIn.includes('handleMenu')).map((action) => (
        <div
          key={action.id}
          style={styles.item}
          onMouseDown={(e) => { e.preventDefault(); action.handler(view, menu.pos); setMenu(null); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenuOpen(false); }}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={styles.icon}>{action.icon ?? '•'}</span>
          <span style={styles.label}>{action.label}</span>
        </div>
      ))}

      {/* 分隔线 */}
      {(hasTurnInto || menu.blockType === 'heading') && capabilities?.canDelete && (
        <div style={styles.separator} />
      )}

      {/* 删除 */}
      {capabilities?.canDelete && (
        <div
          style={styles.item}
          onMouseDown={(e) => { e.preventDefault(); blockAction.delete(view, menu.pos); setMenu(null); }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#3a3a3a'; setSubMenuOpen(false); }}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={styles.icon}>🗑</span>
          <span style={styles.label}>删除</span>
          <span style={styles.shortcut}>Del</span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'fixed',
    zIndex: 1000,
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '8px',
    padding: '4px',
    minWidth: '180px',
    maxHeight: '400px',
    overflow: 'visible',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
  item: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#e8eaed',
  },
  icon: {
    fontSize: '13px',
    width: '20px',
    textAlign: 'center',
    color: '#999',
  },
  label: {
    flex: 1,
  },
  arrow: {
    color: '#666',
    fontSize: '14px',
  },
  shortcut: {
    fontSize: '11px',
    color: '#666',
  },
  check: {
    color: '#4a9eff',
    fontSize: '13px',
  },
  separator: {
    height: '1px',
    background: '#444',
    margin: '4px 8px',
  },
  turnIntoWrapper: {
    position: 'relative',
  },
  subMenu: {
    position: 'absolute',
    left: '100%',
    top: '-4px',
    paddingLeft: '6px',  // 透明间隔保持 hover 连续
    zIndex: 10,
  },
  subMenuPanel: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '8px',
    padding: '4px',
    minWidth: '160px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  },
};

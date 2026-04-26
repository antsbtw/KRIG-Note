import type { CSSProperties } from 'react';

/**
 * FolderTree 统一样式。
 *
 * 视觉常量集中在此，避免分散到各处。
 * 所有插件复用，保证不同 NavSide 面板视觉一致。
 */

export const TREE_ROW_HEIGHT = 28;
export const TREE_INDENT_PX = 16;

export const styles = {
  container: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    outline: 'none',
  } as CSSProperties,

  empty: {
    padding: '24px 16px',
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
  } as CSSProperties,

  row: {
    display: 'flex',
    alignItems: 'center',
    height: TREE_ROW_HEIGHT,
    padding: '0 8px',
    cursor: 'pointer',
    userSelect: 'none',
    color: '#ccc',
    fontSize: 13,
    gap: 6,
  } as CSSProperties,

  rowHover: {
    background: 'rgba(255,255,255,0.05)',
  } as CSSProperties,

  rowSelected: {
    background: 'rgba(74, 144, 226, 0.25)',
    color: '#fff',
  } as CSSProperties,

  rowDropTarget: {
    background: 'rgba(74, 144, 226, 0.18)',
    outline: '1px dashed rgba(74, 144, 226, 0.6)',
    outlineOffset: -1,
  } as CSSProperties,

  /** 折叠箭头 */
  caret: {
    width: 12,
    color: '#888',
    fontSize: 10,
    flexShrink: 0,
    textAlign: 'center',
  } as CSSProperties,

  /** 主图标（item 类型标记 / folder 📁） */
  icon: {
    width: 18,
    flexShrink: 0,
    fontSize: 14,
    textAlign: 'center',
  } as CSSProperties,

  title: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as CSSProperties,

  rightHint: {
    flexShrink: 0,
    color: '#666',
    fontSize: 10,
    paddingLeft: 8,
  } as CSSProperties,

  contextMenu: {
    position: 'fixed',
    background: 'rgba(30,30,30,0.98)',
    border: '1px solid #444',
    borderRadius: 4,
    boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
    padding: '4px 0',
    minWidth: 140,
    zIndex: 2000,
    fontSize: 12,
    color: '#ccc',
  } as CSSProperties,

  contextMenuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 10px',
    cursor: 'pointer',
  } as CSSProperties,

  contextMenuItemDisabled: {
    color: '#555',
    cursor: 'default',
  } as CSSProperties,

  contextMenuSeparator: {
    height: 1,
    background: '#444',
    margin: '4px 0',
  } as CSSProperties,
};

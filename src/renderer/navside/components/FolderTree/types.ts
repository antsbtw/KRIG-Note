import type { ReactNode } from 'react';

/**
 * FolderTree 数据契约（v1.4 NavSide 重构 spec § 4.1）。
 *
 * 设计原则：业务零知识。
 * - 不出现 "note" / "graph" / "ebook" / "variant" 等业务字眼
 * - 强制统一布局：item 行 [icon][title][rightHint]，folder 行 [📁][title][箭头]
 * - 不允许插件接管整行渲染（无 renderItem / renderFolder 逃生口）
 *
 * 业务通过 ItemNode.payload 传任意数据，通过 itemMeta 函数提取标准字段。
 */

export type TreeNode = FolderNode | ItemNode;

export interface FolderNode {
  kind: 'folder';
  id: string;
  parentId: string | null;
  title: string;
  /** 是否展开（受控） */
  expanded: boolean;
  /** 已构建的子节点（已排序） */
  children: TreeNode[];
}

export interface ItemNode {
  kind: 'item';
  id: string;
  parentId: string | null;
  /** 业务自定义 payload，FolderTree 不解析；itemMeta 收到原样 */
  payload: unknown;
  /** 排序键（外部已按此排序，FolderTree 不重排） */
  sortKey?: number | string;
}

/**
 * Item 视觉元数据。
 *
 * 框架强制布局：
 *   [icon][title 占满中间][rightHint 右对齐]
 *
 * 主 icon 即类型标记 —— 同插件不同子类型用不同 icon（spec § 4.5）。
 */
export interface ItemMeta {
  /** 主图标。emoji 字符串（'📄' / '⚛'）或 ReactNode */
  icon: string | ReactNode;
  /** 主标题 */
  title: string;
  /** 右侧 hint（通常是相对时间，可选） */
  rightHint?: string;
}

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  separator?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export type KeyAction = 'delete' | 'rename' | 'enter';

export interface FolderTreeProps {
  /** 树数据（根节点列表，已构建好层级 + 排序） */
  nodes: TreeNode[];

  /** 选中节点 id 集合（受控） */
  selectedIds: Set<string>;
  onSelectChange: (ids: Set<string>) => void;

  /** 展开/折叠（受控） */
  onFolderToggle: (folderId: string, expanded: boolean) => void;

  /**
   * Item 视觉元数据提取（必填，强制统一布局）。
   * FolderTree 用返回的字段渲染统一 [icon][title][rightHint] 布局。
   */
  itemMeta: (item: ItemNode) => ItemMeta;

  /** 单击 item 行 */
  onItemClick?: (item: ItemNode, e: React.MouseEvent) => void;
  /** 双击 item 行 */
  onItemDoubleClick?: (item: ItemNode) => void;

  /** 右键菜单：返回菜单项数组；返回空数组则不显示菜单。target 为 null 表示空白处右键 */
  contextMenu?: (target: TreeNode | null, e: React.MouseEvent) => ContextMenuItem[];

  /** 拖拽是否启用 */
  draggable?: boolean;
  /** 拖放完成时回调（业务决定怎么 reparent / 重排）。targetFolderId = null 表示拖到根 */
  onDrop?: (draggedIds: string[], targetFolderId: string | null) => void;

  /** 键盘动作（Delete / Enter / 方向键 + 焦点节点） */
  onKeyAction?: (action: KeyAction, target: TreeNode) => void;

  /**
   * 受控的重命名状态。
   * 当 renamingId === node.id 时，FolderTree 在该节点 title 位置渲染受控 input。
   * 业务通过 onRenamingChange 更新值，onRenameCommit/Cancel 处理提交/取消。
   *
   * 这是 v1.4 框架内置的重命名通用 UI（不是业务逃生口；是横向能力）。
   */
  renamingId?: string | null;
  renamingValue?: string;
  onRenamingChange?: (value: string) => void;
  onRenameCommit?: (id: string) => void;
  onRenameCancel?: () => void;

  /** 空态文字（默认 "暂无内容"） */
  emptyText?: string;
}

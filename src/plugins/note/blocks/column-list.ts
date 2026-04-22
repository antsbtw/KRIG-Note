import type { BlockDef, NodeViewFactory } from '../types';

/**
 * columnList + column — 多列布局（ContainerBlock）
 *
 * columnList 包含 2-3 个 column，每个 column 包含 block+。
 *
 * 功能：
 * - Toolbar：+/−/垂直对齐 三个按钮（hover 显示）
 * - Resize Handle：列间拖拽调整宽度（最小 20%）
 * - column attrs：verticalAlign / width
 */

const MIN_COL_PCT = 20;
const GAP = 16; // px, flex gap between columns

interface DragState {
  handleIndex: number;
  startX: number;
  leftColDom: HTMLElement;
  rightColDom: HTMLElement;
  usableWidth: number;
  leftStartPct: number;
  rightStartPct: number;
}

// ── columnList NodeView ──────────────────────────────────

const columnListNodeView: NodeViewFactory = (node, view, getPos) => {
  const dom = document.createElement('div');
  dom.classList.add('column-list');
  dom.setAttribute('data-columns', String(node.attrs.columns || 2));

  // ─── Toolbar ───────────────────────────────────────

  const toolbar = document.createElement('div');
  toolbar.classList.add('column-list__toolbar');
  toolbar.setAttribute('contenteditable', 'false');

  const addBtn = document.createElement('button');
  addBtn.classList.add('column-list__toolbar-btn');
  addBtn.textContent = '+';
  addBtn.title = 'Add column';
  addBtn.type = 'button';

  const removeBtn = document.createElement('button');
  removeBtn.classList.add('column-list__toolbar-btn');
  removeBtn.textContent = '−';
  removeBtn.title = 'Remove last column';
  removeBtn.type = 'button';

  const alignBtn = document.createElement('button');
  alignBtn.classList.add('column-list__toolbar-btn');
  alignBtn.title = 'Cycle vertical alignment';
  alignBtn.type = 'button';

  const alignIcons: Record<string, string> = { top: '⬆', center: '⬍', bottom: '⬇' };
  const alignCycle = ['top', 'center', 'bottom'];

  function getCurrentAlign(): string {
    const pos = getPos();
    if (pos == null) return 'top';
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode || currentNode.childCount === 0) return 'top';
    return currentNode.child(0).attrs.verticalAlign || 'top';
  }

  function syncAlignBtn() {
    alignBtn.textContent = alignIcons[getCurrentAlign()] || '⬆';
  }

  alignBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos == null) return;
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode) return;

    const nextAlign = alignCycle[(alignCycle.indexOf(getCurrentAlign()) + 1) % alignCycle.length];
    let tr = view.state.tr;
    let offset = pos + 1;
    for (let i = 0; i < currentNode.childCount; i++) {
      const child = currentNode.child(i);
      if (child.type.name === 'column') {
        tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, verticalAlign: nextAlign });
      }
      offset += child.nodeSize;
    }
    view.dispatch(tr);
  });

  toolbar.append(addBtn, removeBtn, alignBtn);

  // ─── Content wrapper (for positioning handles) ─────

  const wrapper = document.createElement('div');
  wrapper.classList.add('column-list__wrapper');

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('column-list__content');

  wrapper.appendChild(contentDOM);
  dom.append(toolbar, wrapper);

  // ─── Resize handles (absolute-positioned over gap) ──

  const handleContainer = document.createElement('div');
  handleContainer.classList.add('column-list__handles');
  handleContainer.setAttribute('contenteditable', 'false');
  wrapper.appendChild(handleContainer);

  let dragState: DragState | null = null;
  let rafId: number | null = null;

  function updateHandles() {
    handleContainer.innerHTML = '';
    const cols = contentDOM.querySelectorAll(':scope > .column') as NodeListOf<HTMLElement>;
    if (cols.length < 2) return;

    const wrapperRect = wrapper.getBoundingClientRect();

    for (let i = 0; i < cols.length - 1; i++) {
      const leftRect = cols[i].getBoundingClientRect();

      const handle = document.createElement('div');
      handle.classList.add('column-list__handle');
      handle.style.left = `${leftRect.right - wrapperRect.left}px`;
      handle.style.width = `${GAP}px`;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startDrag(i, e, handle);
      });

      handleContainer.appendChild(handle);
    }
  }

  function scheduleUpdateHandles() {
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      updateHandles();
      rafId = null;
    });
  }

  function startDrag(handleIdx: number, e: MouseEvent, handle: HTMLElement) {
    const cols = Array.from(contentDOM.querySelectorAll(':scope > .column')) as HTMLElement[];
    const leftCol = cols[handleIdx];
    const rightCol = cols[handleIdx + 1];
    if (!leftCol || !rightCol) return;

    const containerWidth = contentDOM.getBoundingClientRect().width;
    const totalGaps = (cols.length - 1) * GAP;
    const usableWidth = containerWidth - totalGaps;

    dragState = {
      handleIndex: handleIdx,
      startX: e.clientX,
      leftColDom: leftCol,
      rightColDom: rightCol,
      usableWidth,
      leftStartPct: (leftCol.getBoundingClientRect().width / usableWidth) * 100,
      rightStartPct: (rightCol.getBoundingClientRect().width / usableWidth) * 100,
    };

    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function clamp(leftPct: number, rightPct: number): [number, number] {
    const total = leftPct + rightPct;
    if (leftPct < MIN_COL_PCT) return [MIN_COL_PCT, total - MIN_COL_PCT];
    if (rightPct < MIN_COL_PCT) return [total - MIN_COL_PCT, MIN_COL_PCT];
    return [leftPct, rightPct];
  }

  function onDragMove(e: MouseEvent) {
    if (!dragState) return;
    const deltaPct = ((e.clientX - dragState.startX) / dragState.usableWidth) * 100;
    const [lp, rp] = clamp(dragState.leftStartPct + deltaPct, dragState.rightStartPct - deltaPct);

    dragState.leftColDom.style.flex = `${lp} 0 0`;
    dragState.leftColDom.style.width = '';
    dragState.rightColDom.style.flex = `${rp} 0 0`;
    dragState.rightColDom.style.width = '';

    scheduleUpdateHandles();
  }

  function onDragEnd(e: MouseEvent) {
    if (!dragState) return;
    const deltaPct = ((e.clientX - dragState.startX) / dragState.usableWidth) * 100;
    let [lp, rp] = clamp(dragState.leftStartPct + deltaPct, dragState.rightStartPct - deltaPct);
    lp = Math.round(lp * 10) / 10;
    rp = Math.round(rp * 10) / 10;

    const pos = getPos();
    if (pos != null) {
      const currentNode = view.state.doc.nodeAt(pos);
      if (currentNode) {
        let tr = view.state.tr;
        let offset = pos + 1;
        for (let i = 0; i < currentNode.childCount; i++) {
          const child = currentNode.child(i);
          if (i === dragState.handleIndex) {
            tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: lp });
          } else if (i === dragState.handleIndex + 1) {
            tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: rp });
          }
          offset += child.nodeSize;
        }
        view.dispatch(tr);
      }
    }

    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    dragState = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  // ─── Add / Remove column ───────────────────────────

  addBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos == null) return;
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode || currentNode.childCount >= 3) return;

    const schema = view.state.schema;
    const newColumn = schema.nodes.column.create(null, [schema.nodes.textBlock.create()]);
    const insertPos = pos + currentNode.nodeSize - 1;
    let tr = view.state.tr.insert(insertPos, newColumn);

    // 重置所有列宽为等宽
    let offset = pos + 1;
    for (let i = 0; i < currentNode.childCount; i++) {
      const child = currentNode.child(i);
      if (child.attrs.width != null) {
        tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: null });
      }
      offset += child.nodeSize;
    }
    tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, columns: currentNode.childCount + 1 });
    view.dispatch(tr);
  });

  removeBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos();
    if (pos == null) return;
    const currentNode = view.state.doc.nodeAt(pos);
    if (!currentNode || currentNode.childCount <= 2) return;

    const lastChild = currentNode.child(currentNode.childCount - 1);
    const lastChildPos = pos + currentNode.nodeSize - 1 - lastChild.nodeSize;
    let tr = view.state.tr.delete(lastChildPos, lastChildPos + lastChild.nodeSize);

    // 重置所有列宽为等宽
    let offset = pos + 1;
    for (let i = 0; i < currentNode.childCount - 1; i++) {
      const child = currentNode.child(i);
      if (child.attrs.width != null) {
        tr = tr.setNodeMarkup(offset, undefined, { ...child.attrs, width: null });
      }
      offset += child.nodeSize;
    }
    tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, columns: currentNode.childCount - 1 });
    view.dispatch(tr);
  });

  // ─── Sync UI state ─────────────────────────────────

  function syncToolbar(updatedNode: import('prosemirror-model').Node) {
    addBtn.style.display = updatedNode.childCount >= 3 ? 'none' : '';
    removeBtn.style.display = updatedNode.childCount <= 2 ? 'none' : '';
    dom.setAttribute('data-columns', String(updatedNode.childCount));
    syncAlignBtn();
  }

  syncToolbar(node);

  // 初始 handle 构建（等 PM 渲染完 column 子节点）
  setTimeout(scheduleUpdateHandles, 50);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'columnList') return false;
      syncToolbar(updatedNode);
      scheduleUpdateHandles();
      return true;
    },
    ignoreMutation(mutation: MutationRecord) {
      if (toolbar.contains(mutation.target)) return true;
      if (handleContainer.contains(mutation.target)) return true;
      return false;
    },
    stopEvent(event: Event) {
      const t = event.target as HTMLElement;
      if (toolbar.contains(t)) return true;
      if (handleContainer.contains(t)) return true;
      return false;
    },
    destroy() {
      if (rafId != null) cancelAnimationFrame(rafId);
      if (dragState) {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    },
  };
};

// ── column NodeView ──────────────────────────────────────

const columnNodeView: NodeViewFactory = (node) => {
  const dom = document.createElement('div');
  dom.classList.add('column');

  function syncAttrs(n: import('prosemirror-model').Node) {
    dom.setAttribute('data-vertical-align', n.attrs.verticalAlign || 'top');
    const width = n.attrs.width as number | null;
    if (width != null) {
      dom.style.flex = `${width} 0 0`;
    } else {
      dom.style.flex = '1';
    }
    dom.style.width = '';
  }
  syncAttrs(node);

  const contentDOM = document.createElement('div');
  contentDOM.classList.add('column__content');
  dom.appendChild(contentDOM);

  return {
    dom,
    contentDOM,
    update(updatedNode) {
      if (updatedNode.type.name !== 'column') return false;
      syncAttrs(updatedNode);
      return true;
    },
  };
};

// ── BlockDef 导出 ────────────────────────────────────────

export const columnListBlock: BlockDef = {
  name: 'columnList',
  group: 'block',
  nodeSpec: {
    content: 'column{2,3}',
    group: 'block',
    isolating: true,
    attrs: {
      columns: { default: 2 },
    },
    parseDOM: [{ tag: 'div.column-list' }],
    toDOM() { return ['div', { class: 'column-list' }, 0]; },
  },
  nodeView: columnListNodeView,
  capabilities: { turnInto: ['textBlock'], canDelete: true, canDrag: true, cascadeBoundary: true },
  containerRule: {},
  slashMenu: { label: '2 Columns', icon: '▥', group: 'layout', keywords: ['column', 'two', '两列'], order: 2 },
};

export const columnBlock: BlockDef = {
  name: 'column',
  group: '',
  nodeSpec: {
    content: 'block+',
    isolating: true,
    attrs: {
      verticalAlign: { default: 'top' },
      width: { default: null },
    },
    parseDOM: [{ tag: 'div.column' }],
    toDOM() { return ['div', { class: 'column' }, 0]; },
  },
  nodeView: columnNodeView,
  capabilities: { cascadeBoundary: true },
  containerRule: {},
  slashMenu: null,
};

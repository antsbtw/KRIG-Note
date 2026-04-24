import type { EditorState, Transaction } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import type { Node as PMNode, Schema } from 'prosemirror-model';

type ListTypeName = 'orderedList' | 'bulletList' | 'taskList';

/**
 * setTextBlockLevel —— 把指定位置的 textBlock 切换到目标 level（null = paragraph，1/2/3 = heading）。
 *
 * 身处 list 容器（orderedList / bulletList / taskList）时：
 *   无论目标 level，都把这一项从所有 list 祖先中脱出——循环切割：每层 list 被切成
 *   前段 + 提取行 + 后段，直到提取行的父不再是 list。对齐 Notion："Turn Into 切断
 *   连续同类型兄弟节点后，列表自然断成前后两段"的视觉。
 *
 *   orderedList 转 heading 时，会把当前项的编号（"N. "）注入到提取文本前作为普通字符，
 *   方便看清原序号；转 paragraph、其他 list 类型不注入。
 *
 *   前段保留原容器属性；后段 orderedList 的 start 重置为 1，其他 list 保留默认属性。
 *
 * 其他容器（callout / toggle / blockquote / column / table 等）不做脱壳——对齐 Notion
 * "Turn Into 只改 type、不移动 block" 的语义。
 *
 * 这个函数同时被键盘快捷键（Cmd+Alt+1/2/3、Cmd+Alt+0）和 HandleMenu turn-into 调用，
 * 确保两条路径行为一致。
 */
export function setTextBlockLevel(
  state: EditorState,
  pos: number,
  level: number | null,
): Transaction | null {
  const node = state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'textBlock' || node.attrs.isTitle) return null;

  const info = resolveListContext(state, pos);
  if (!info) {
    // 不在 list 中 → 直接改 level attr
    return state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
  }

  // 在 list 中 → 循环 lift 直到提取行的父不再是 list
  let tr = state.tr;
  let currentPos = pos;
  let currentInfo: ListContext | null = info;
  // 首次 lift：需要用到 level（注入序号前缀 + 设置 level attr）
  // 后续 lift：level 已经在第一次写入、前缀已经在第一次注入，后续只做结构外推
  let isFirstLift = true;
  const safetyLimit = 16;
  let iter = 0;

  while (currentInfo && iter < safetyLimit) {
    iter++;
    const liftResult = liftOnce(
      tr,
      currentPos,
      isFirstLift ? level : null,
      currentInfo,
      state.schema,
      /* writeLevel= */ isFirstLift,
    );
    if (!liftResult) break;
    tr = liftResult.tr;
    currentPos = liftResult.newPos;
    isFirstLift = false;

    // 用新 doc 重新判断父类型
    currentInfo = resolveListContextOnDoc(tr.doc, currentPos);
  }

  return tr;
}

/** list 上下文：提取行所在 list 节点的 depth 和类型 */
interface ListContext {
  listDepth: number;
  listTypeName: ListTypeName;
}

function resolveListContext(state: EditorState, pos: number): ListContext | null {
  return resolveListContextOnDoc(state.doc, pos);
}

function resolveListContextOnDoc(doc: PMNode, pos: number): ListContext | null {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;

  if (parent.type.name === 'orderedList' || parent.type.name === 'bulletList') {
    return { listDepth: $pos.depth, listTypeName: parent.type.name as ListTypeName };
  }

  // taskList → taskItem → textBlock
  if (parent.type.name === 'taskItem' && $pos.depth >= 2) {
    const grand = $pos.node($pos.depth - 1);
    if (grand.type.name === 'taskList') {
      return { listDepth: $pos.depth - 1, listTypeName: 'taskList' };
    }
  }

  return null;
}

/**
 * 在 tr 上做一次"把 list 中的某项抽出"操作，返回更新后的 tr 和提取行的新 pos。
 *
 * writeLevel=true 时，提取行会被重建（设置新的 level attr；orderedList + heading 时
 * 注入序号前缀）。writeLevel=false 时，提取行用原节点的 content + attrs（保留已经在
 * 上一轮设置好的 level 和前缀），只做结构外推。
 *
 * 返回 null 表示无法 lift（schema 不符等兜底保护）。
 */
function liftOnce(
  tr: Transaction,
  itemPos: number,
  level: number | null,
  ctx: ListContext,
  schema: Schema,
  writeLevel: boolean,
): { tr: Transaction; newPos: number } | null {
  const { listDepth, listTypeName } = ctx;
  const doc = tr.doc;
  const itemNode = doc.nodeAt(itemPos);
  if (!itemNode) return null;

  const $item = doc.resolve(itemPos);
  const listNode = $item.node(listDepth);
  if (listNode.type.name !== listTypeName) return null;

  const listStart = $item.before(listDepth);
  const listEnd = $item.after(listDepth);

  const textBlockType = schema.nodes.textBlock;
  const listType = schema.nodes[listTypeName];

  // 当前项在 list 中的索引
  //   orderedList / bulletList：$item.index(listDepth) = textBlock 在 list 中的索引
  //   taskList：$item.index(listDepth) = taskItem 在 taskList 中的索引（即用户视觉的第 N 行）
  const itemIndex = $item.index(listDepth);

  // 构造提取行
  let extractedNode: PMNode;
  if (writeLevel) {
    let extractedContent: Fragment;
    if (listTypeName === 'orderedList' && level !== null) {
      const startAttr = (listNode.attrs.start as number) ?? 1;
      const orderNumber = startAttr + itemIndex;
      const prefix = schema.text(`${orderNumber}. `);
      extractedContent = Fragment.from(prefix).append(itemNode.content);
    } else {
      extractedContent = itemNode.content;
    }
    extractedNode = textBlockType.create(
      { ...itemNode.attrs, level },
      extractedContent,
    );
  } else {
    // 后续迭代：提取行原样外推，attrs/content 已在首轮处理完
    extractedNode = itemNode;
  }

  // 切割前后段
  //   orderedList / bulletList：children 是 textBlock，按 index 切
  //   taskList：children 是 taskItem，按 index 切（taskItem 壳连同其中的子节点保留）
  const before: PMNode[] = [];
  const after: PMNode[] = [];
  listNode.forEach((child, _offset, idx) => {
    if (idx < itemIndex) before.push(child);
    else if (idx > itemIndex) after.push(child);
  });

  const replacement: PMNode[] = [];
  if (before.length > 0) {
    // 前段：保留原 list attrs（orderedList 保留 start）
    replacement.push(listType.create(listNode.attrs, Fragment.fromArray(before)));
  }
  // 提取行的新位置：前段 list 的 nodeSize 之后、listStart 起点之后
  const beforeSize = before.length > 0
    ? listType.create(listNode.attrs, Fragment.fromArray(before)).nodeSize
    : 0;
  replacement.push(extractedNode);
  if (after.length > 0) {
    if (listTypeName === 'orderedList') {
      replacement.push(listType.create({ ...listNode.attrs, start: 1 }, Fragment.fromArray(after)));
    } else {
      replacement.push(listType.create(listNode.attrs, Fragment.fromArray(after)));
    }
  }

  const newTr = tr.replaceWith(listStart, listEnd, Fragment.fromArray(replacement));
  // 提取行在替换区间里的绝对位置 = listStart + beforeSize
  // （listStart 是前段 list 起点；前段 nodeSize 后就是提取行起点）
  const newPos = listStart + beforeSize;
  return { tr: newTr, newPos };
}

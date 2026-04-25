import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { Schema } from 'prosemirror-model';
import { blockRegistry } from '../../note/registry';
import { registerAllBlocks } from '../../note/blocks';
import type { Atom } from './GraphEngine';

/**
 * NodeContentRenderer — spec v1.2 § 7
 *
 * 把 atom 数组用 readonly ProseMirror 渲染到 CSS2DObject 的 div 中，
 * 复用 NoteView 的 blockRegistry schema。这样节点能显示任意 Block 类型
 * （textBlock / mathBlock / codeBlock / bulletList 等）。
 *
 * 与 NoteEditor 的关系:
 * - 共享：blockRegistry.buildSchema() 产生的 schema、Block 渲染逻辑
 * - 不共享：NoteEditor 的 React 组件（含 thoughtPlugin / titleGuard / aiSync 等
 *   GraphView 不需要的能力，且绑定 noteId 数据流）
 */

let schemaCache: Schema | null = null;
let registered = false;

/** 拿到（并初始化）共享 schema。第一次调用会注册所有 Block 类型。 */
export function getNodeContentSchema(): Schema {
  if (!schemaCache) {
    if (!registered) {
      registerAllBlocks();
      blockRegistry.initConverters();
      registered = true;
    }
    schemaCache = blockRegistry.buildSchema();
  }
  return schemaCache;
}

/**
 * 把 atom 数组渲染为只读视图，挂载到给定 container。
 * 返回一个 EditorView 句柄，外部可以 dispatch 新 doc 来更新内容（不重建实例）。
 */
function createReadonlyView(container: HTMLElement, atoms: Atom[]): EditorView {
  const schema = getNodeContentSchema();
  const doc = schema.nodeFromJSON({ type: 'doc', content: atoms });
  const state = EditorState.create({ doc });
  const view = new EditorView(container, {
    state,
    editable: () => false,    // readonly
    attributes: { class: 'krig-graph-node-content' },
  });
  return view;
}

/** 节点 / 边内容的 CSS2DObject + 关联的 EditorView 句柄 */
interface MountedContent {
  obj: CSS2DObject;
  view: EditorView;
}

/**
 * 渲染器：负责节点 label 和边 label 的 CSS2DObject 创建/更新/销毁。
 * 节点 label 挂在 mesh 的 child；边 label 挂在 scene 上（位置由调用方算出）。
 */
export class NodeContentRenderer {
  private nodeContents = new Map<string, MountedContent>();
  private edgeContents = new Map<string, MountedContent>();

  // ── 节点 label ──

  /** 给节点挂 label，返回 CSS2DObject 让调用方决定 position（在 mesh 上的局部坐标） */
  mountNodeLabel(nodeId: string, atoms: Atom[], parent: THREE.Object3D): CSS2DObject {
    this.unmountNodeLabel(nodeId);

    const div = document.createElement('div');
    div.dataset.kind = 'node-label';
    div.dataset.nodeId = nodeId;
    applyNodeLabelStyle(div);

    const view = createReadonlyView(div, atoms);
    const obj = new CSS2DObject(div);
    parent.add(obj);

    this.nodeContents.set(nodeId, { obj, view });
    return obj;
  }

  /** 节点 label 内容变化时调用，不重建 CSS2DObject 只更新 doc */
  updateNodeLabel(nodeId: string, atoms: Atom[]): void {
    const entry = this.nodeContents.get(nodeId);
    if (!entry) return;
    const schema = getNodeContentSchema();
    const newDoc = schema.nodeFromJSON({ type: 'doc', content: atoms });
    const tr = entry.view.state.tr.replaceWith(0, entry.view.state.doc.content.size, newDoc.content);
    entry.view.dispatch(tr);
  }

  unmountNodeLabel(nodeId: string): void {
    const entry = this.nodeContents.get(nodeId);
    if (!entry) return;
    entry.view.destroy();
    entry.obj.parent?.remove(entry.obj);
    entry.obj.element.remove();
    this.nodeContents.delete(nodeId);
  }

  setNodeLabelVisible(nodeId: string, visible: boolean): void {
    const entry = this.nodeContents.get(nodeId);
    if (entry) entry.obj.visible = visible;
  }

  /** 获取节点 label DOM（用于 dblclick 编辑等） */
  getNodeLabelElement(nodeId: string): HTMLElement | null {
    return this.nodeContents.get(nodeId)?.obj.element ?? null;
  }

  // ── 边 label ──

  /** 边 label 直接挂到 scene；位置由调用方设置（弧线中点） */
  mountEdgeLabel(edgeId: string, atoms: Atom[], scene: THREE.Scene, x: number, y: number): CSS2DObject {
    this.unmountEdgeLabel(edgeId);

    const div = document.createElement('div');
    div.dataset.kind = 'edge-label';
    div.dataset.edgeId = edgeId;
    applyEdgeLabelStyle(div);

    const view = createReadonlyView(div, atoms);
    const obj = new CSS2DObject(div);
    obj.position.set(x, y, 0);
    scene.add(obj);

    this.edgeContents.set(edgeId, { obj, view });
    return obj;
  }

  updateEdgeLabel(edgeId: string, atoms: Atom[]): void {
    const entry = this.edgeContents.get(edgeId);
    if (!entry) return;
    const schema = getNodeContentSchema();
    const newDoc = schema.nodeFromJSON({ type: 'doc', content: atoms });
    const tr = entry.view.state.tr.replaceWith(0, entry.view.state.doc.content.size, newDoc.content);
    entry.view.dispatch(tr);
  }

  /** 边 label 位置更新（节点拖动时调用） */
  setEdgeLabelPosition(edgeId: string, x: number, y: number): void {
    const entry = this.edgeContents.get(edgeId);
    if (entry) entry.obj.position.set(x, y, 0);
  }

  unmountEdgeLabel(edgeId: string): void {
    const entry = this.edgeContents.get(edgeId);
    if (!entry) return;
    entry.view.destroy();
    entry.obj.parent?.remove(entry.obj);
    entry.obj.element.remove();
    this.edgeContents.delete(edgeId);
  }

  setEdgeLabelVisible(edgeId: string, visible: boolean): void {
    const entry = this.edgeContents.get(edgeId);
    if (entry) entry.obj.visible = visible;
  }

  getEdgeLabelElement(edgeId: string): HTMLElement | null {
    return this.edgeContents.get(edgeId)?.obj.element ?? null;
  }

  // ── 全清 ──

  disposeAll(): void {
    for (const id of Array.from(this.nodeContents.keys())) this.unmountNodeLabel(id);
    for (const id of Array.from(this.edgeContents.keys())) this.unmountEdgeLabel(id);
  }
}

// ── 样式（独立函数，便于将来集中调整） ──

function applyNodeLabelStyle(div: HTMLDivElement): void {
  div.style.cssText = `
    color: #e0e0e0;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.4;
    padding: 4px 8px;
    background: rgba(30,30,30,0.85);
    border-radius: 4px;
    max-width: 240px;
    pointer-events: auto;
    cursor: text;
    user-select: none;
    text-align: center;
  `;
}

function applyEdgeLabelStyle(div: HTMLDivElement): void {
  div.style.cssText = `
    color: #aaa;
    font-size: 11px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    line-height: 1.3;
    padding: 1px 6px;
    background: rgba(30,30,30,0.7);
    border-radius: 2px;
    max-width: 200px;
    pointer-events: auto;
    cursor: text;
    user-select: none;
    min-width: 8px;
    min-height: 14px;
  `;
}

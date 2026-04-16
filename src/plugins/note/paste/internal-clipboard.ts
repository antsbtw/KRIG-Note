/**
 * internal-clipboard — KRIG 内部剪贴板通道
 *
 * 在 PM 默认 HTML 序列化之外，独立写一份 PM JSON 到剪贴板。这条通道：
 *
 *   - 只服务于 KRIG 内部复制粘贴/拖拽移动
 *   - 用 PM 自带的 Slice.toJSON / Slice.fromJSON，无需任何节点白名单
 *   - schema 里加什么节点都自动支持，以后无需改这里
 *
 * ── 传输承载 ──
 * macOS / Electron 的系统剪贴板会剥掉 application/* 自定义 MIME，所以我们
 * 把 JSON 嵌入到 text/html 里——HTML 是标准类型，不会被剥。
 *
 * 编码格式：HTML 末尾追加一个不可见注释
 *   <!--krig-doc:BASE64_OF_JSON-->
 *
 * 外部应用（Word / Notion / 浏览器）读 HTML 时看到注释当作正常 HTML 注释忽略，
 * 不影响他们的解析；我们读 HTML 时扫描这个 marker 取出 JSON。
 */

import { Slice, DOMSerializer } from 'prosemirror-model';
import type { Schema } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { blockSelectionKey } from '../plugins/block-selection';

/** dataTransfer / clipboard 上额外存放"源节点位置"的 marker，供拖拽 move 删除原位置使用。 */
export const KRIG_SOURCE_POS_MIME = 'application/x-krig-source-pos';

const KRIG_HTML_MARKER_PREFIX = '<!--krig-doc:';
const KRIG_HTML_MARKER_SUFFIX = '-->';
// 整体匹配 marker（贪婪到第一个 -->）
const KRIG_HTML_MARKER_REGEX = /<!--krig-doc:([A-Za-z0-9+/=]+)-->/;

/**
 * 把 Slice 序列化为字符串（PM JSON）。仅给内部消费。
 */
export function serializeForInternalClipboard(slice: Slice): string {
  return JSON.stringify(slice.toJSON());
}

/**
 * 反序列化字符串为 Slice。失败返回 null（剪贴板内容损坏 / 跨版本不兼容时）。
 */
export function parseInternalClipboard(json: string, schema: Schema): Slice | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Slice.fromJSON(schema, parsed);
  } catch {
    return null;
  }
}

/**
 * 把 KRIG JSON 嵌入到一段 HTML 字符串里。
 *
 * @param baseHtml 用户可见的 HTML 内容（用于外部应用粘贴的回退）。可以传空字符串。
 * @param json     serializeForInternalClipboard 的输出
 */
export function embedKrigDataInHtml(baseHtml: string, json: string): string {
  const base64 = utf8ToBase64(json);
  return `${baseHtml || ''}${KRIG_HTML_MARKER_PREFIX}${base64}${KRIG_HTML_MARKER_SUFFIX}`;
}

/**
 * 从 HTML 字符串中提取 KRIG JSON（如果存在）。返回 null 表示该 HTML 不是
 * KRIG 内部剪贴板内容（外部应用复制出来的普通 HTML 不会含 marker）。
 */
export function extractKrigDataFromHtml(html: string): string | null {
  if (!html) return null;
  const m = html.match(KRIG_HTML_MARKER_REGEX);
  if (!m) return null;
  try {
    return base64ToUtf8(m[1]);
  } catch {
    return null;
  }
}

// ── 高层 helper：write / read 整套 KRIG 数据到 DataTransfer / ClipboardData ──

/**
 * 计算"用户想复制的内容"对应的 Slice。
 *
 * 两种 selection 来源殊途同归（都过 doc.slice + includeParents=true 保留容器）：
 *   1. block-selection plugin 激活：用 selectedPositions 的最小 → 最大范围
 *   2. 普通 PM Selection：用 selection.content()
 *
 * 无白名单——schema 里有什么节点都自动支持。
 */
export function computeSliceForClipboard(state: EditorState): Slice | null {
  const blockSel = blockSelectionKey.getState(state);
  if (blockSel?.active && blockSel.selectedPositions.length > 0) {
    const positions = [...blockSel.selectedPositions].sort((a, b) => a - b);
    const firstPos = positions[0];
    const lastPos = positions[positions.length - 1];
    const lastNode = state.doc.nodeAt(lastPos);
    if (lastNode) {
      return state.doc.slice(firstPos, lastPos + lastNode.nodeSize, true);
    }
  }
  const sel = state.selection;
  if (sel.empty) return null;
  return sel.content();
}

/**
 * 把 Slice 写入 DataTransfer：
 *   - text/html: PM 渲染的 HTML + 末尾 KRIG marker（注释）
 *   - text/plain: 选区文字内容（外部应用兜底）
 *
 * 复制粘贴和拖拽都用这个。复制要求 event.preventDefault()，由调用方负责。
 */
export function writeKrigDataToTransfer(
  dataTransfer: DataTransfer,
  slice: Slice,
  schema: Schema,
): void {
  const json = serializeForInternalClipboard(slice);
  const baseHtml = sliceToHtmlString(slice, schema);
  const htmlWithKrig = embedKrigDataInHtml(baseHtml, json);
  const plain = slice.content.textBetween(0, slice.content.size, '\n\n');
  dataTransfer.setData('text/html', htmlWithKrig);
  dataTransfer.setData('text/plain', plain);
}

/**
 * 反向：从 DataTransfer / ClipboardData 提取 KRIG Slice。
 * 失败返回 null（不是 KRIG 内容、HTML 无 marker、JSON 损坏、schema 不兼容时）。
 */
export function readKrigDataFromTransfer(
  dataTransfer: DataTransfer,
  schema: Schema,
): Slice | null {
  const html = dataTransfer.getData('text/html') || '';
  const json = extractKrigDataFromHtml(html);
  if (!json) return null;
  return parseInternalClipboard(json, schema);
}

/** 用 PM DOMSerializer 把 Slice 渲染为 HTML 字符串。 */
function sliceToHtmlString(slice: Slice, schema: Schema): string {
  const serializer = DOMSerializer.fromSchema(schema);
  const fragment = serializer.serializeFragment(slice.content);
  const container = document.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

// ── base64 ↔ utf-8 ────────────────────────────────────────────
// 浏览器原生 atob/btoa 只支持 latin1，中文会乱码。这里用 TextEncoder/Decoder
// 走 utf-8 字节流再过 base64，避免编码丢失。

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

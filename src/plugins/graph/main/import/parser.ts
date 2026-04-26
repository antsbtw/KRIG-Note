/**
 * Markdown 导入解析器 — MD → ParseResult。
 *
 * 解析规则见 docs/graph/KRIG-Graph-Import-Spec.md §3-4。
 *
 * 输入：MD 文本（含 frontmatter）
 * 输出：ParseResult { meta, geometries, intensions, warnings }
 * 不输出 presentation atom — 位置由布局引擎实时计算
 */
import type { GeometryKind } from '../../substance/types';
import type { IntensionValueKind } from './registries';
import { relationPredicateRegistry, valueKindRegistry } from './registries';

export interface ParsedMeta {
  title?: string;
  graph_variant?: string;
  dimension?: 2 | 3;
  folder_id?: string | null;
  active_layout?: string;
}

export interface ParsedGeometry {
  /** 解析时分配的临时 id（导入器据此创建实际记录） */
  id: string;
  kind: GeometryKind;
  /** 引用下层几何体的临时 id */
  members: string[];
}

export interface ParsedIntensionAtom {
  subject_id: string;
  predicate: string;
  value: string;
  value_kind: IntensionValueKind;
  sort_order: number;
}

export interface ParseResult {
  meta: ParsedMeta;
  geometries: ParsedGeometry[];
  intensions: ParsedIntensionAtom[];
  /** 引用了不存在的 id 等问题 */
  warnings: string[];
}

// ── 正则常量 ──

const ID_REGEX = /^[a-z0-9][a-z0-9-]*$/;
/** `# 标题 [[node-id]] {kind: surface}` — heading + 可选 {kind: ...} */
const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*\[\[([a-z0-9][a-z0-9-]*)\]\](?:\s*\{([^}]*)\})?\s*$/;
/** `- key :: value` 或 `- key :: value {extras}` */
const ATOM_LINE_REGEX = /^[-*]\s+([\w-]+)\s*::\s*(.+?)(?:\s*\{[^}]*\})?\s*$/;
/** `> 引用` */
const QUOTE_LINE_REGEX = /^>\s*(.*)$/;
/** 行内 [[id]] */
const INLINE_REF_REGEX = /\[\[([a-z0-9][a-z0-9-]*)\]\]/g;
/** value 中提取 [[id]]（用于关系类 predicate 生成 Line） */
const REF_VALUE_REGEX = /^\[\[([a-z0-9][a-z0-9-]*)\]\]$/;

// ── frontmatter 解析（轻量手写，避免引 gray-matter 依赖） ──

interface FrontmatterResult {
  data: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(content: string): FrontmatterResult {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { data: {}, body: content };
  }
  // 找到第二个 '---' 分隔符
  const lines = content.split(/\r?\n/);
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { endIdx = i; break; }
  }
  if (endIdx === -1) return { data: {}, body: content };

  const fmLines = lines.slice(1, endIdx);
  const data: Record<string, unknown> = {};
  for (const line of fmLines) {
    const m = /^([\w_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let raw = m[2].trim();
    // 去掉两端引号
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    // 类型推断
    if (raw === 'null' || raw === '~') data[key] = null;
    else if (raw === 'true') data[key] = true;
    else if (raw === 'false') data[key] = false;
    else if (/^-?\d+$/.test(raw)) data[key] = parseInt(raw, 10);
    else if (/^-?\d+\.\d+$/.test(raw)) data[key] = parseFloat(raw);
    else data[key] = raw;
  }

  const body = lines.slice(endIdx + 1).join('\n');
  return { data, body };
}

// ── kind 标签解析 ──

/**
 * 解析 heading 后的 `{kind: surface, ...}` 段。
 * 默认 kind = 'point'。
 */
function parseHeadingTags(tagsStr: string | undefined): { kind: GeometryKind } {
  let kind: GeometryKind = 'point';
  if (!tagsStr) return { kind };
  const m = /\bkind\s*:\s*(point|line|surface|volume)\b/.exec(tagsStr);
  if (m) kind = m[1] as GeometryKind;
  return { kind };
}

// ── 主解析函数 ──

export function parseMarkdown(content: string): ParseResult {
  const warnings: string[] = [];
  const { data: fmData, body } = parseFrontmatter(content);

  // ── meta ──
  const meta: ParsedMeta = {};
  if (typeof fmData.title === 'string') meta.title = fmData.title;
  if (typeof fmData.graph_variant === 'string') meta.graph_variant = fmData.graph_variant;
  if (fmData.dimension === 2 || fmData.dimension === 3) meta.dimension = fmData.dimension;
  if (typeof fmData.folder_id === 'string' || fmData.folder_id === null) meta.folder_id = fmData.folder_id as string | null;
  if (typeof fmData.active_layout === 'string') meta.active_layout = fmData.active_layout;

  // ── 第一遍扫描：收集所有 heading 的 [[id]] + kind ──
  const lines = body.split(/\r?\n/);
  const idRegistry = new Map<string, GeometryKind>();
  const seenIds = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_REGEX.exec(lines[i]);
    if (!m) continue;
    const id = m[3];
    const tagsStr = m[4];
    const { kind } = parseHeadingTags(tagsStr);
    if (!ID_REGEX.test(id)) {
      warnings.push(`Invalid id "${id}" at line ${i + 1}: must match ${ID_REGEX}`);
      continue;
    }
    if (seenIds.has(id)) {
      warnings.push(`Duplicate id "${id}" at line ${i + 1}: previous definition kept, this one skipped`);
      continue;
    }
    seenIds.add(id);
    idRegistry.set(id, kind);
  }

  // ── 第二遍扫描：解析每个 heading section ──
  const geometries: ParsedGeometry[] = [];
  const intensions: ParsedIntensionAtom[] = [];

  let currentId: string | null = null;
  let currentKind: GeometryKind = 'point';
  let currentLabel = '';
  /** 同一 subject 下，每个 predicate 的 sort_order 计数器 */
  let predicateCounters: Map<string, number> = new Map();
  /** 当前 section 的 description 段累积 */
  let descriptionLines: string[] = [];
  /** 当前 geometry 累积的 members（surface/volume 用 boundary 关系类追加） */
  let currentMembers: string[] = [];
  /** 当前节点已处理过的 line member（防同一 [[x]] 多次成为 member 重复） */
  let memberSet: Set<string> = new Set();

  /** flush 当前 section：把 description 提交、把 geometry 写入 */
  function flushCurrent(): void {
    if (!currentId) return;
    // 提交 geometry（members 来自 boundary 关系类追加）
    geometries.push({
      id: currentId,
      kind: currentKind,
      members: [...currentMembers],
    });

    // label intension
    if (currentLabel) {
      intensions.push({
        subject_id: currentId,
        predicate: 'label',
        value: currentLabel,
        value_kind: 'text',
        sort_order: 0,
      });
    }
    // description intension（如果有累积内容）
    const description = descriptionLines.join('\n').trim();
    if (description) {
      intensions.push({
        subject_id: currentId,
        predicate: 'description',
        value: description,
        value_kind: 'text',
        sort_order: 0,
      });
    }
  }

  /** 添加一条 intension atom，自动管理 sort_order */
  function addIntension(subject: string, predicate: string, value: string, valueKind: IntensionValueKind): void {
    const key = `${subject}::${predicate}`;
    const order = predicateCounters.get(key) ?? 0;
    predicateCounters.set(key, order + 1);
    intensions.push({
      subject_id: subject,
      predicate,
      value,
      value_kind: valueKind,
      sort_order: order,
    });
  }

  /** 处理关系类 predicate（含双重身份：可能生成 Line + 加 members） */
  function handleRelationClass(
    subjectId: string,
    predicate: string,
    targetId: string,
    lineNum: number,
  ): void {
    const config = relationPredicateRegistry.get(predicate);
    if (!config) return;

    // 验证目标 id 存在
    if (!idRegistry.has(targetId)) {
      warnings.push(`Reference to unknown id "${targetId}" at line ${lineNum} (predicate: ${predicate})`);
      return;
    }

    // boundary 特殊：把目标加到当前几何体的 members（不生成新 Line）
    if (config.addToMembers) {
      if (!memberSet.has(targetId)) {
        currentMembers.push(targetId);
        memberSet.add(targetId);
      }
      return;
    }

    // 生成 Line 几何体
    if (config.generateGeometry === 'line') {
      const lineId = `line:${subjectId}->${targetId}:${predicate}`;
      // 防重复（同 subject+target+predicate 只生成一次 Line）
      if (!geometries.some((g) => g.id === lineId)) {
        geometries.push({
          id: lineId,
          kind: 'line',
          members: [subjectId, targetId],
        });
        // 给这条 Line 加 type intension
        intensions.push({
          subject_id: lineId,
          predicate: 'type',
          value: predicate,
          value_kind: 'text',
          sort_order: 0,
        });
        // 自动用对应的 substance（如 'contains' → 'relation-contains'）
        const substanceId = `relation-${predicate}`;
        intensions.push({
          subject_id: lineId,
          predicate: 'substance',
          value: substanceId,
          value_kind: 'ref',
          sort_order: 0,
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = HEADING_REGEX.exec(line);

    if (headingMatch) {
      // 提交上一个 section
      flushCurrent();

      // 开新 section
      currentLabel = headingMatch[2].trim();
      currentId = headingMatch[3];
      const tagsStr = headingMatch[4];
      currentKind = parseHeadingTags(tagsStr).kind;
      predicateCounters = new Map();
      descriptionLines = [];
      currentMembers = [];
      memberSet = new Set();
      continue;
    }

    if (currentId === null) continue;  // heading 之前的内容跳过

    // `> 摘要` → summary intension
    const quoteMatch = QUOTE_LINE_REGEX.exec(line);
    if (quoteMatch) {
      const summary = quoteMatch[1].trim();
      if (summary) addIntension(currentId, 'summary', summary, 'text');
      continue;
    }

    // `- key :: value` → intension atom（可能含关系类双重身份）
    const atomMatch = ATOM_LINE_REGEX.exec(line);
    if (atomMatch) {
      const predicate = atomMatch[1];
      const rawValue = atomMatch[2].trim();

      // 关系类 predicate：value 必须是 [[id]] 格式
      if (relationPredicateRegistry.has(predicate)) {
        const refMatch = REF_VALUE_REGEX.exec(rawValue);
        if (refMatch) {
          const targetId = refMatch[1];
          // 加 intension（关系类自身也是一条 atom）
          addIntension(currentId, predicate, targetId, 'ref');
          // 处理双重身份（Line / member）
          handleRelationClass(currentId, predicate, targetId, i + 1);
        } else {
          warnings.push(`Relation predicate "${predicate}" at line ${i + 1} expects [[id]] value, got: ${rawValue}`);
          // 仍然存为 intension（用户可能在写文档过程中）
          addIntension(currentId, predicate, rawValue, valueKindRegistry.infer(rawValue));
        }
        continue;
      }

      // 非关系类：普通 intension atom
      // 特例：substance predicate 的 value 是 substance library id，按 ref 处理
      const valueKind = predicate === 'substance' ? 'ref' : valueKindRegistry.infer(rawValue);
      addIntension(currentId, predicate, rawValue, valueKind);
      continue;
    }

    // 普通段落 → 累加到 description；扫描行内 [[id]] 生成隐式 refs
    if (line.trim()) {
      descriptionLines.push(line);

      // 行内 [[id]] → 隐式 refs（每个引用都生成 Line + intension）
      // 用 matchAll 收集本行所有 [[id]]
      INLINE_REF_REGEX.lastIndex = 0;
      let inlineMatch: RegExpExecArray | null;
      while ((inlineMatch = INLINE_REF_REGEX.exec(line)) !== null) {
        const targetId = inlineMatch[1];
        // 仅当目标存在时才作为隐式 refs（不存在则警告）
        if (!idRegistry.has(targetId)) {
          warnings.push(`Reference to unknown id "${targetId}" at line ${i + 1} (inline)`);
          continue;
        }
        // 防重：行内同一 [[x]] 多次只算一次
        const key = `${currentId}::refs::${targetId}`;
        if (predicateCounters.has(key)) continue;
        addIntension(currentId, 'refs', targetId, 'ref');
        handleRelationClass(currentId, 'refs', targetId, i + 1);
      }
    } else if (descriptionLines.length > 0) {
      // 空行：保留段落分隔
      descriptionLines.push('');
    }
  }

  // flush 最后一个 section
  flushCurrent();

  return { meta, geometries, intensions, warnings };
}

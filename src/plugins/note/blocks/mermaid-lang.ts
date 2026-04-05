/**
 * Mermaid 语法高亮 — CodeMirror 6 StreamLanguage
 *
 * 轻量级实现，覆盖 Mermaid 常用关键字、连接线、字符串等。
 */

import { StreamLanguage } from '@codemirror/language';

const DIAGRAM_TYPES = new Set([
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'mindmap', 'timeline',
  'gitGraph', 'journey', 'quadrantChart', 'sankey', 'xychart-beta',
  'block-beta', 'packet-beta', 'kanban', 'architecture-beta',
]);

const KEYWORDS = new Set([
  'subgraph', 'end', 'direction', 'participant', 'actor', 'as',
  'note', 'over', 'of', 'loop', 'alt', 'else', 'opt', 'par', 'and',
  'critical', 'break', 'rect', 'activate', 'deactivate',
  'class', 'section', 'title', 'dateFormat', 'axisFormat',
  'click', 'callback', 'link', 'style', 'classDef', 'linkStyle',
  'TD', 'TB', 'LR', 'RL', 'BT',
  'left', 'right',
]);

const mermaidStreamParser = {
  startState() { return {}; },
  token(stream: any) {
    // 行注释 %%
    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }

    // 字符串 "..." 或 '...'
    if (stream.match(/"[^"]*"/) || stream.match(/'[^']*'/)) {
      return 'string';
    }

    // 方括号内容 [text] — 节点标签
    if (stream.match(/\[[^\]]*\]/)) {
      return 'string';
    }

    // 花括号内容 {text} — 菱形节点
    if (stream.match(/\{[^}]*\}/)) {
      return 'string';
    }

    // 圆括号内容 (text) — 圆角/圆形节点
    if (stream.match(/\(\([^)]*\)\)/) || stream.match(/\([^)]*\)/)) {
      return 'string';
    }

    // 连接线 -->|label|, -->, ---,  -.->  ==>  --text-->
    if (stream.match(/--+>|==+>|\.-+>|--+[^>]+-+>/)) {
      return 'operator';
    }
    if (stream.match(/---+|===+|\.-+\./)) {
      return 'operator';
    }

    // 箭头标签 |text|
    if (stream.match(/\|[^|]*\|/)) {
      return 'attribute';
    }

    // 序列图箭头 ->> -->> -x --x -)  --)
    if (stream.match(/->>|-->>|-x|--x|-\)|--\)/)) {
      return 'operator';
    }

    // 数字
    if (stream.match(/\d+(\.\d+)?/)) {
      return 'number';
    }

    // 标识符/关键字
    if (stream.match(/[\w-]+/)) {
      const word = stream.current();
      if (DIAGRAM_TYPES.has(word)) return 'keyword';
      if (KEYWORDS.has(word)) return 'keyword';
      return 'variableName';
    }

    // 冒号
    if (stream.match(':')) return 'punctuation';

    // 分号
    if (stream.match(';')) return 'punctuation';

    // 其他字符
    stream.next();
    return null;
  },
};

export const mermaidLanguage = StreamLanguage.define(mermaidStreamParser);

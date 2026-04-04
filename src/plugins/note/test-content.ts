import type { Schema, Node as PMNode } from 'prosemirror-model';

/**
 * 测试文档 — 三基类架构
 */

function text(schema: Schema, str: string): PMNode {
  return schema.text(str);
}

function p(schema: Schema, content?: string): PMNode {
  return schema.node('textBlock', null, content ? [text(schema, content)] : []);
}

function heading(schema: Schema, level: number, content: string): PMNode {
  return schema.node('textBlock', { level }, [text(schema, content)]);
}

export function buildTestDocument(schema: Schema): PMNode {
  return schema.node('doc', null, [
    schema.node('textBlock', { isTitle: true }, [text(schema, '重建测试文档')]),

    // ── 一、TextBlock 基础 ──
    heading(schema, 2, '一、TextBlock 基础'),
    p(schema, '1.1 普通段落，可以编辑'),
    p(schema, '1.2 回车 → 新 paragraph'),
    p(schema, '1.3 Cmd+Alt+1/2/3 切换标题，Cmd+Alt+0 转回文本'),
    p(schema),

    // ── 二、Heading ──
    heading(schema, 2, '二、Heading 测试'),
    heading(schema, 1, 'H1 标题'),
    heading(schema, 2, 'H2 标题'),
    heading(schema, 3, 'H3 标题'),
    p(schema),

    // ── 三、Marks ──
    heading(schema, 2, '三、Mark 格式化'),
    schema.node('textBlock', null, [
      text(schema, '预置：'),
      schema.text('加粗', [schema.marks.bold.create()]),
      text(schema, ' / '),
      schema.text('斜体', [schema.marks.italic.create()]),
      text(schema, ' / '),
      schema.text('下划线', [schema.marks.underline.create()]),
      text(schema, ' / '),
      schema.text('行内代码', [schema.marks.code.create()]),
    ]),
    p(schema),

    // ── 四、ContainerBlock 测试 ──
    heading(schema, 2, '四、ContainerBlock 测试'),

    // bulletList
    p(schema, '4.1 bulletList：'),
    schema.node('bulletList', null, [
      p(schema, '无序列表项 1'),
      p(schema, '无序列表项 2'),
      p(schema, '无序列表项 3'),
    ]),

    // orderedList
    p(schema, '4.2 orderedList：'),
    schema.node('orderedList', null, [
      p(schema, '有序步骤一'),
      p(schema, '有序步骤二'),
      p(schema, '有序步骤三'),
    ]),

    // taskList
    p(schema, '4.3 taskList：'),
    schema.node('taskList', null, [
      p(schema, '任务一'),
      p(schema, '任务二'),
      p(schema, '任务三'),
    ]),

    // blockquote
    p(schema, '4.4 blockquote：'),
    schema.node('blockquote', null, [
      p(schema, '引用第一行'),
      p(schema, '引用第二行'),
    ]),

    // callout
    p(schema, '4.5 callout：'),
    schema.node('callout', { emoji: '💡' }, [
      p(schema, '这是一个提示框'),
      p(schema, '支持多行内容'),
    ]),

    // ── 五、嵌套测试 ──
    heading(schema, 2, '五、Container 嵌套测试'),

    // callout 内嵌 bulletList
    p(schema, '5.1 callout 内嵌 bulletList：'),
    schema.node('callout', { emoji: '🔥' }, [
      p(schema, '提示框内容'),
      schema.node('bulletList', null, [
        p(schema, '嵌套 bullet A'),
        p(schema, '嵌套 bullet B'),
      ]),
    ]),

    // blockquote 内嵌 bulletList
    p(schema, '5.2 blockquote 内嵌 bulletList：'),
    schema.node('blockquote', null, [
      p(schema, '引用内容'),
      schema.node('bulletList', null, [
        p(schema, '引用内 bullet A'),
        p(schema, '引用内 bullet B'),
      ]),
      p(schema, '引用继续'),
    ]),

    // bulletList 嵌套 bulletList（三级）
    p(schema, '5.3 三级 bulletList 嵌套：'),
    schema.node('bulletList', null, [
      p(schema, '一级 bullet'),
      schema.node('bulletList', null, [
        p(schema, '二级 bullet（◦）'),
        schema.node('bulletList', null, [
          p(schema, '三级 bullet（▪）'),
        ]),
      ]),
      p(schema, '回到一级'),
    ]),

    // bulletList 内嵌 orderedList
    p(schema, '5.4 bulletList 内嵌 orderedList：'),
    schema.node('bulletList', null, [
      p(schema, '要点 A'),
      schema.node('orderedList', null, [
        p(schema, '嵌套编号 1'),
        p(schema, '嵌套编号 2'),
      ]),
      p(schema, '要点 B'),
    ]),

    // ── 六、键盘交互测试 ──
    heading(schema, 2, '六、键盘交互测试'),
    p(schema, '6.1 在 Container 内回车 → 新行（仍在 Container 内）'),
    p(schema, '6.2 空行回车 → 退出 Container'),
    p(schema, '6.3 行首 Backspace → 退出 Container（首子节点）'),
    p(schema, '6.4 Markdown 快捷：- / 1. / [] / > + 空格'),
    p(schema),

    // ── 七、noteTitle 测试 ──
    heading(schema, 2, '七、noteTitle 测试'),
    p(schema, '7.1 文档首行大标题'),
    p(schema, '7.2 清空 → Untitled'),
    p(schema, '7.3 不可删除'),
    p(schema),
  ]);
}

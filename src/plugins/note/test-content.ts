import type { Schema, Node as PMNode } from 'prosemirror-model';

/**
 * 测试文档 — 最小可验证版本
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

    heading(schema, 2, '一、TextBlock 基础'),
    p(schema, '1.1 这是一个普通段落，可以编辑'),
    p(schema, '1.2 回车 → 创建新 paragraph'),
    p(schema, '1.3 空行按 Backspace → 删除'),
    p(schema),

    heading(schema, 2, '二、Heading 测试'),
    heading(schema, 1, 'H1 标题'),
    heading(schema, 2, 'H2 标题'),
    heading(schema, 3, 'H3 标题'),
    p(schema, '2.1 Cmd+Alt+1/2/3 切换标题级别'),
    p(schema, '2.2 Cmd+Alt+0 转回文本'),

    heading(schema, 2, '三、Mark 格式化'),
    p(schema, '3.1 选中文字测试：Cmd+B 加粗 / Cmd+I 斜体 / Cmd+U 下划线'),
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

    heading(schema, 2, '四、noteTitle 测试'),
    p(schema, '4.1 文档首行 40px 大标题'),
    p(schema, '4.2 清空标题 → 显示 Untitled'),
    p(schema, '4.3 标题不可删除'),

    p(schema),
  ]);
}

import type { Schema, Node as PMNode } from 'prosemirror-model';

/**
 * 测试文档 — 按设计文档逐项验证
 *
 * 对照 docs/block/base/ 三基类契约，覆盖所有功能点。
 */

function text(schema: Schema, str: string): PMNode { return schema.text(str); }
function p(schema: Schema, content?: string): PMNode {
  return schema.node('textBlock', null, content ? [text(schema, content)] : []);
}
function heading(schema: Schema, level: number, content: string): PMNode {
  return schema.node('textBlock', { level }, [text(schema, content)]);
}

export function buildTestDocument(schema: Schema): PMNode {
  return schema.node('doc', null, [
    schema.node('textBlock', { isTitle: true }, [text(schema, '三基类架构 — 测试文档')]),

    // ════════════════════════════════════════════════════════
    // 一、TextBlock 基类（text-block.md）
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '一、TextBlock 基类'),

    // §4.1 level 视觉变体
    heading(schema, 2, '1.1 Heading 级别'),
    heading(schema, 1, 'H1 标题（30px 700）'),
    heading(schema, 2, 'H2 标题（24px 600）'),
    heading(schema, 3, 'H3 标题（20px 600）'),
    p(schema, '普通段落（16px normal）'),
    p(schema, '测试：Cmd+Alt+1/2/3 切换标题，Cmd+Alt+0 转回文本'),

    // §4.2 noteTitle
    heading(schema, 2, '1.2 noteTitle'),
    p(schema, '• 文档首行 40px 大标题'),
    p(schema, '• 清空标题 → 显示 Untitled placeholder'),
    p(schema, '• 不可删除、不可拖拽'),
    p(schema, '• Handle 不出现在 noteTitle 上'),

    // §3 Marks
    heading(schema, 2, '1.3 Marks 格式化'),
    schema.node('textBlock', null, [
      schema.text('加粗', [schema.marks.bold.create()]),
      text(schema, '(Cmd+B) / '),
      schema.text('斜体', [schema.marks.italic.create()]),
      text(schema, '(Cmd+I) / '),
      schema.text('下划线', [schema.marks.underline.create()]),
      text(schema, '(Cmd+U) / '),
      schema.text('删除线', [schema.marks.strike.create()]),
      text(schema, '(Cmd+Shift+S) / '),
      schema.text('行内代码', [schema.marks.code.create()]),
      text(schema, '(Cmd+E)'),
    ]),
    p(schema, '测试：选中文字 → FloatingToolbar 弹出 → 点击格式化按钮'),
    schema.node('textBlock', null, [
      text(schema, '颜色：'),
      schema.text('红色文字', [schema.marks.textStyle.create({ color: '#ff5252' })]),
      text(schema, ' / 高亮：'),
      schema.text('黄色高亮', [schema.marks.highlight.create({ color: 'yellow' })]),
    ]),

    // §2.1 Inline 节点
    heading(schema, 2, '1.4 Inline 节点'),
    schema.node('textBlock', null, [
      text(schema, 'hardBreak 测试（Shift+Enter）：第一行'),
      schema.nodes.hardBreak.create(),
      text(schema, '第二行（同一个 paragraph）'),
    ]),
    p(schema, '/math → 行内公式，/link → 笔记链接'),

    // §6 键盘行为
    heading(schema, 2, '1.5 键盘行为'),
    p(schema, '• Enter：光标中间 → 分裂；末尾 → 新行；空行 → 新行'),
    p(schema, '• Backspace：空行 → 删除；行首 → 与上行合并'),
    p(schema, '• Shift+Enter → hardBreak（软换行）'),
    p(schema, '• Tab → indent +1，Shift+Tab → indent -1'),
    p(schema),

    // §7 Markdown 输入规则
    heading(schema, 2, '1.6 Markdown 快捷输入'),
    p(schema, '在空行行首输入以下内容（含末尾空格）：'),
    p(schema, '# → H1 / ## → H2 / ### → H3'),
    p(schema, '- 或 * → bulletList / 1. → orderedList'),
    p(schema, '[] → taskList / > → blockquote'),
    p(schema, '``` → codeBlock / --- → horizontalRule'),
    p(schema, '在下方空行测试：'),
    p(schema),

    // ════════════════════════════════════════════════════════
    // 二、ContainerBlock 基类（container-block.md）
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '二、ContainerBlock 基类'),

    // §4.2 bulletList
    heading(schema, 2, '2.1 bulletList'),
    schema.node('bulletList', null, [
      p(schema, '无序列表项 1'),
      p(schema, '无序列表项 2'),
      p(schema, '无序列表项 3'),
    ]),
    p(schema, '测试：Enter 新行 / 空行 Enter 退出 / Backspace 行首退出'),

    // §4.2 orderedList
    heading(schema, 2, '2.2 orderedList'),
    schema.node('orderedList', null, [
      p(schema, '有序步骤一'),
      p(schema, '有序步骤二'),
      p(schema, '有序步骤三'),
    ]),
    p(schema, '测试：编号自动递增 / Enter 新行 / 空行 Enter 退出'),

    // §4.2 taskList
    heading(schema, 2, '2.3 taskList'),
    schema.node('taskList', null, [
      p(schema, '任务一'),
      p(schema, '任务二'),
      p(schema, '任务三'),
    ]),
    p(schema, '测试：checkbox 显示 / Enter 新行 / 空行 Enter 退出'),

    // §4.2 blockquote
    heading(schema, 2, '2.4 blockquote'),
    schema.node('blockquote', null, [
      p(schema, '引用第一行'),
      p(schema, '引用第二行'),
    ]),
    p(schema, '测试：竖线包裹 / Enter 新行 / 空行 Enter 退出'),

    // §4.2 callout
    heading(schema, 2, '2.5 callout'),
    schema.node('callout', { emoji: '💡' }, [
      p(schema, '这是一个提示框'),
      p(schema, '支持多行内容'),
    ]),
    schema.node('callout', { emoji: '⚠️' }, [
      p(schema, '警告提示框'),
    ]),
    p(schema, '测试：emoji 点击切换 / 背景色包裹 / Enter 新行 / 空行 Enter 退出'),

    // §4.2 toggleList
    heading(schema, 2, '2.6 toggleList'),
    schema.node('toggleList', { open: true }, [
      p(schema, '折叠列表标题（点击 ▾ 折叠）'),
      p(schema, '折叠的子内容 1'),
      p(schema, '折叠的子内容 2'),
    ]),

    // §4.2 toggleHeading
    heading(schema, 2, '2.7 toggleHeading'),
    schema.node('toggleHeading', { open: true }, [
      heading(schema, 2, '折叠标题（点击 ▾ 折叠）'),
      p(schema, '折叠标题的子内容'),
      p(schema, '更多子内容'),
    ]),

    // §4.2 frameBlock
    heading(schema, 2, '2.8 frameBlock'),
    schema.node('frameBlock', { color: '#8ab4f8' }, [
      p(schema, '蓝色边框内容'),
      p(schema, '点击左侧边框切换颜色'),
    ]),

    // §3.1 嵌套
    heading(schema, 2, '2.9 Container 嵌套测试'),
    p(schema, '2.9.1 callout 内嵌 bulletList：'),
    schema.node('callout', { emoji: '🔥' }, [
      p(schema, '提示框内容'),
      schema.node('bulletList', null, [
        p(schema, '嵌套 bullet A'),
        p(schema, '嵌套 bullet B'),
      ]),
      p(schema, '提示框继续'),
    ]),
    p(schema, '2.9.2 blockquote 内嵌 orderedList：'),
    schema.node('blockquote', null, [
      p(schema, '引用内容'),
      schema.node('orderedList', null, [
        p(schema, '嵌套编号 1'),
        p(schema, '嵌套编号 2'),
      ]),
      p(schema, '引用继续'),
    ]),
    p(schema, '2.9.3 三级 bulletList 嵌套（• → ◦ → ▪）：'),
    schema.node('bulletList', null, [
      p(schema, '一级 bullet（•）'),
      schema.node('bulletList', null, [
        p(schema, '二级 bullet（◦）'),
        schema.node('bulletList', null, [
          p(schema, '三级 bullet（▪）'),
        ]),
      ]),
      p(schema, '回到一级'),
    ]),
    p(schema, '2.9.4 bulletList 内嵌 orderedList：'),
    schema.node('bulletList', null, [
      p(schema, '要点 A'),
      schema.node('orderedList', null, [
        p(schema, '嵌套编号 1'),
        p(schema, '嵌套编号 2'),
      ]),
      p(schema, '要点 B'),
    ]),

    // §6 键盘交互
    heading(schema, 2, '2.10 Container 键盘交互'),
    p(schema, '• Enter（有内容）→ 在 Container 内创建新行'),
    p(schema, '• Enter（空行）→ 退出 Container（退到上一级）'),
    p(schema, '• Backspace（行首首子）→ unwrap 退出 Container'),
    p(schema, '在下方创建 Container 测试键盘交互：'),
    p(schema),

    // ════════════════════════════════════════════════════════
    // 三、RenderBlock 基类（render-block.md）
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '三、RenderBlock 基类'),

    heading(schema, 2, '3.1 codeBlock'),
    schema.node('codeBlock', { language: 'javascript' }),
    p(schema, '测试：输入代码 / Enter 换行 / 双 Enter 退出 / toolbar hover 显示'),

    heading(schema, 2, '3.2 mathBlock'),
    schema.node('mathBlock', { latex: 'E = mc^2' }),
    schema.node('mathBlock', { latex: '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' }),
    p(schema, '测试：点击编辑 LaTeX / Escape 退出 / KaTeX 渲染'),

    heading(schema, 2, '3.3 image'),
    schema.node('image', { src: null }, [p(schema)]),
    p(schema, '测试：点击上传图片 / caption 编辑'),

    heading(schema, 2, '3.4 videoBlock'),
    schema.node('videoBlock', { src: null }, [p(schema)]),
    p(schema, '测试：输入 URL / 播放器显示'),

    heading(schema, 2, '3.5 audioBlock'),
    schema.node('audioBlock', { src: null }, [p(schema)]),
    p(schema, '测试：上传音频 / 播放器显示'),

    heading(schema, 2, '3.6 tweetBlock'),
    schema.node('tweetBlock', { tweetUrl: null }, [p(schema)]),
    p(schema, '测试：输入 URL / 预览显示'),

    // ════════════════════════════════════════════════════════
    // 四、特殊 Block
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '四、特殊 Block'),

    heading(schema, 2, '4.1 horizontalRule'),
    schema.node('horizontalRule'),
    p(schema, '测试：--- 创建 / 显示为水平线'),

    heading(schema, 2, '4.2 table'),
    schema.node('table', null, [
      schema.node('tableRow', null, [
        schema.node('tableHeader', null, [p(schema, '列 A')]),
        schema.node('tableHeader', null, [p(schema, '列 B')]),
        schema.node('tableHeader', null, [p(schema, '列 C')]),
      ]),
      schema.node('tableRow', null, [
        schema.node('tableCell', null, [p(schema, '数据 1')]),
        schema.node('tableCell', null, [p(schema, '数据 2')]),
        schema.node('tableCell', null, [p(schema, '数据 3')]),
      ]),
    ]),
    p(schema, '测试：Tab 跳转单元格 / 输入内容'),

    heading(schema, 2, '4.3 columnList'),
    schema.node('columnList', { columns: 2 }, [
      schema.node('column', null, [p(schema, '左列内容')]),
      schema.node('column', null, [p(schema, '右列内容')]),
    ]),
    p(schema, '测试：两列布局 / 在列内编辑'),

    // ════════════════════════════════════════════════════════
    // 五、UI 组件
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '五、UI 组件'),

    heading(schema, 2, '5.1 SlashMenu'),
    p(schema, '在空行输入 / → 弹出菜单 → 方向键选择 → Enter 确认 → Escape 关闭'),
    p(schema),

    heading(schema, 2, '5.2 FloatingToolbar'),
    p(schema, '选中本段文字 → 弹出 B/I/U/S/<> 工具栏 → 点击格式化'),

    heading(schema, 2, '5.3 Block Handle'),
    p(schema, '鼠标悬停本段 → 左侧出现 + ⠿ 手柄'),
    p(schema, '• + 按钮 → 下方插入新段落'),
    p(schema, '• ⠿ 按钮 → 弹出 HandleMenu（转换/删除）'),

    heading(schema, 2, '5.4 ContextMenu'),
    p(schema, '右键本段 → 弹出 Cut/Copy/Paste/Delete 菜单'),

    // 底部空行
    p(schema),
    p(schema),
  ]);
}

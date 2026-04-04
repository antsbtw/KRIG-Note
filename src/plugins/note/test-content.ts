import type { Schema, Node as PMNode } from 'prosemirror-model';

/**
 * 测试文档 — NoteView 启动时加载
 *
 * 包含所有已注册 Block 的测试内容，方便逐条验证。
 * 等 NoteFile 存储系统实现后，替换为从存储加载。
 */

function text(schema: Schema, str: string): PMNode {
  return schema.text(str);
}

function p(schema: Schema, content: string): PMNode {
  return schema.node('textBlock', null, content ? [text(schema, content)] : []);
}

function heading(schema: Schema, level: number, content: string): PMNode {
  return schema.node('textBlock', { level }, [text(schema, content)]);
}

export function buildTestDocument(schema: Schema): PMNode {
  return schema.node('doc', null, [
    // 标题
    schema.node('textBlock', { isTitle: true }, null, [text(schema, 'NoteView 测试文档')]),

    // ── 一、noteTitle 测试 ──
    heading(schema, 2, '一、noteTitle 测试'),
    p(schema, '1.1 删除标题文字 → 应显示 Untitled placeholder'),
    p(schema, '1.2 标题末尾按 Enter → 光标跳到下方 paragraph'),
    p(schema, '1.3 连续按 Enter → 全部创建 paragraph（不创建第二个 noteTitle）'),
    p(schema, '1.4 空标题按 Backspace → 不删除'),
    p(schema, '1.5 Handle 不出现在 noteTitle 上'),

    // ── 二、paragraph 测试 ──
    heading(schema, 2, '二、paragraph 测试'),
    p(schema, '2.1 这是一个普通段落，可以编辑'),
    p(schema, '2.2 回车 → 创建新 paragraph'),
    p(schema, '2.3 空 paragraph 按 Backspace → 删除'),
    p(schema, '2.4 Handle 出现在左侧'),
    p(schema, '2.5 Handle 菜单：Turn into Heading / Code Block / Quote / Delete'),

    // ── 三、Mark 格式化 ──
    heading(schema, 2, '三、Mark 格式化测试'),
    p(schema, '3.1 选中下面的文字测试格式化：'),
    p(schema, '这是测试文字 请选中我 然后点击工具栏按钮或使用快捷键'),
    p(schema, '3.2 快捷键：Cmd+B 加粗 / Cmd+I 斜体 / Cmd+U 下划线 / Cmd+E 行内代码'),
    p(schema, '3.3 codeBlock 中选中文字 → FloatingToolbar 不应出现'),

    // ── 四、SlashMenu 测试 ──
    heading(schema, 2, '四、SlashMenu 测试'),
    p(schema, '4.1 在下方空行输入 / 触发 SlashMenu：'),
    p(schema, ''),
    p(schema, '4.2 应显示：Paragraph / Code Block / Bullet List / Numbered List / Quote / Divider'),
    p(schema, '4.3 方向键选择 → Enter 确认 → Escape 关闭'),
    p(schema, '4.4 输入 /code 过滤 → 只显示 Code Block'),

    // ── 五、Handle 菜单测试 ──
    heading(schema, 2, '五、Handle 菜单测试'),
    p(schema, '5.1 鼠标悬停本段落 → Handle（⠿）出现在左侧'),
    p(schema, '5.2 点击 Handle → 弹出操作菜单'),
    p(schema, '5.3 点击 Delete → 本段落被删除'),
    p(schema, '5.4 点击 Turn into Heading → 本段落变为 heading'),

    // ── 六、Block Selection 测试 ──
    heading(schema, 2, '六、Block Selection 测试'),
    p(schema, '6.1 光标在本段落中，按 ESC → 蓝色高亮选中'),
    p(schema, '6.2 再按 ESC → 取消选中'),
    p(schema, '6.3 选中后 Shift+↓ → 扩展选中到下一段'),
    p(schema, '6.4 选中后按 Delete → 删除选中的 Block'),
    p(schema, '6.5 选中后左键单击 → 取消选中'),

    // ── 七、ContextMenu 测试 ──
    heading(schema, 2, '七、ContextMenu 测试'),
    p(schema, '7.1 右键本段落 → 显示 Cut/Copy/Paste（3 项）'),
    p(schema, '7.2 ESC 选中后右键 → 显示 Cut/Copy/Paste + Delete/Indent/Outdent（6 项）'),
    p(schema, '7.3 选中后右键 Cut → Block 被剪切'),
    p(schema, '7.4 右键 Paste → Block 被粘贴回来'),

    // ── 八、enterBehavior 测试 ──
    heading(schema, 2, '八、enterBehavior 测试'),
    p(schema, '8.1 paragraph 按 Enter → 分裂为两个 paragraph'),
    p(schema, '8.2 在下方用 SlashMenu 创建 Code Block，测试 Enter 换行 + 双 Enter 退出：'),
    p(schema, ''),

    // ── 九、Heading Fold 测试（Handle 菜单操作） ──
    heading(schema, 2, '九、Heading Fold 测试'),
    p(schema, '9.1 鼠标悬停 heading → Handle 出现 → 点击 Handle → 菜单中有 Fold'),
    p(schema, '9.2 点击 Fold → heading 下方内容隐藏，标题后显示 ···'),
    p(schema, '9.3 再次点击 Handle → 菜单中显示 Unfold → 点击展开'),
    heading(schema, 3, '9.4 子标题 H3 测试'),
    p(schema, '这段属于 H3 管辖。Fold H3 只隐藏到下一个 H3/H2 之前'),
    p(schema, '这段也属于 H3'),
    heading(schema, 3, '9.5 另一个 H3'),
    p(schema, '这段属于新 H3，不受前面 H3 折叠影响'),
    heading(schema, 2, '9.6 另一个 H2'),
    p(schema, '这段属于新 H2。Fold 上方 H2 不影响这里'),

    // ── 十、toggleList 测试 ──
    heading(schema, 2, '十、toggleList 测试'),
    p(schema, '10.1 SlashMenu 选择 Toggle List → 创建折叠列表（▾ + paragraph）'),
    p(schema, '10.2 在折叠列表内输入子内容'),
    p(schema, '10.3 折叠/展开 → 和 toggleHeading 一致'),
    p(schema, '10.4 在下方创建 Toggle List 测试：'),
    p(schema, ''),

    // ── 十一、Block 级快捷键测试 ──
    heading(schema, 2, '十一、Block 级快捷键测试'),
    p(schema, '11.1 ESC 选中 Block → Cmd+C → 复制（无视觉变化）'),
    p(schema, '11.2 ← 取消选中 → 光标到某位置 → Cmd+V → Block 被粘贴'),
    p(schema, '11.3 ESC 选中 Block → Cmd+X → Block 被剪切'),
    p(schema, '11.4 Cmd+V → Block 被粘贴回来'),
    p(schema, '11.5 ESC 选中 → Shift+↓ 多选 → Cmd+X → 多个 Block 被剪切'),
    p(schema, '11.6 Cmd+V → 多个 Block 被粘贴回来'),

    // ── 十二、turnInto 测试 ──
    heading(schema, 2, '十二、turnInto 测试'),
    p(schema, '12.1 Handle 菜单 Turn into Heading → paragraph 变为 heading'),
    p(schema, '12.2 Handle 菜单 Turn into Code Block → paragraph 变为 codeBlock'),
    p(schema, '12.3 Handle 菜单 Turn into Quote → paragraph 被包裹进 blockquote'),
    p(schema, '12.4 在下方测试 turnInto：'),
    p(schema, '这是一个待转换的段落'),

    // ── 十三、Undo/Redo 测试 ──
    heading(schema, 2, '十三、Undo/Redo 测试'),
    p(schema, '13.1 编辑文字后 Cmd+Z → 撤销'),
    p(schema, '13.2 Cmd+Shift+Z → 重做'),
    p(schema, '13.3 删除 Block 后 Cmd+Z → Block 恢复'),

    // ── 十四、hardBreak 软换行测试 ──
    heading(schema, 2, '十四、hardBreak 软换行测试'),
    p(schema, '14.1 在本段落中间按 Shift+Enter → 插入换行（不创建新段落）'),
    p(schema, '14.2 验证：光标应在同一个 paragraph 内换到下一行'),
    // 预置一个带 hardBreak 的段落
    schema.node('textBlock', null, [
      text(schema, '14.3 这是第一行'),
      schema.nodes.hardBreak.create(),
      text(schema, '这是第二行（同一个 paragraph）'),
    ]),
    p(schema, '14.4 Backspace 可以删除 hardBreak（两行合为一行）'),

    // ── 十五、Task List 测试 ──
    heading(schema, 2, '十五、Task List 测试'),
    p(schema, '15.1 下方是预置的 Task List（ContainerBlock）：'),
    schema.node('taskList', null, [
      p(schema, '未完成的任务'),
      p(schema, '另一个任务'),
      p(schema, '再一个任务'),
    ]),
    p(schema, '15.2 在 Task List 内按 Enter → 新建 taskItem（checkbox 未勾选）'),
    p(schema, '15.3 空 taskItem 按 Enter → 退出 Task List'),
    p(schema, '15.4 Tab → 缩进（嵌套 taskItem），Shift+Tab → 提升'),
    p(schema, '15.5 SlashMenu 输入 /task → 创建新的 Task List'),
    p(schema, ''),

    // ── 十六、Callout 测试 ──
    heading(schema, 2, '十六、Callout 测试'),
    p(schema, '16.1 下方是预置的 Callout：'),
    schema.node('callout', { emoji: '💡' }, [
      p(schema, '这是一个提示框，可以在里面输入任何内容。'),
      p(schema, '支持多个段落。'),
    ]),
    p(schema, '16.2 点击左侧 emoji → 循环切换图标（💡→⚠️→❌→✅→...）'),
    p(schema, '16.3 在 Callout 内按 Enter → 新段落（仍在 Callout 内）'),
    p(schema, '16.4 空段落按 Enter → 退出 Callout'),
    p(schema, '16.5 SlashMenu 输入 /callout → 创建新的 Callout'),
    schema.node('callout', { emoji: '⚠️' }, [
      p(schema, '16.6 不同 emoji 的 Callout'),
    ]),
    schema.node('callout', { emoji: '✅' }, [
      p(schema, '16.7 嵌套测试：Callout 内可以包含其他 Block'),
      schema.node('bulletList', null, [
        p(schema, '列表项 A'),
        p(schema, '列表项 B'),
      ]),
    ]),

    // ── 十六B、Container 嵌套测试 ──
    heading(schema, 2, '十六B、Container 嵌套测试'),
    p(schema, '16B.1 bulletList（ContainerBlock）：'),
    schema.node('bulletList', null, [
      p(schema, '无序列表项 1'),
      p(schema, '无序列表项 2'),
      p(schema, '无序列表项 3'),
    ]),
    p(schema, '16B.2 orderedList（ContainerBlock）：'),
    schema.node('orderedList', null, [
      p(schema, '有序步骤一'),
      p(schema, '有序步骤二'),
      p(schema, '有序步骤三'),
    ]),
    p(schema, '16B.3 blockquote（ContainerBlock）：'),
    schema.node('blockquote', null, [
      p(schema, '这是一段引用'),
      p(schema, '引用可以有多行'),
    ]),
    p(schema, '16B.4 嵌套：callout 内包含 bulletList + orderedList：'),
    schema.node('callout', { emoji: '🔥' }, [
      p(schema, '提示框内容'),
      schema.node('bulletList', null, [
        p(schema, '嵌套的 bullet A'),
        p(schema, '嵌套的 bullet B'),
      ]),
      schema.node('orderedList', null, [
        p(schema, '嵌套的编号 1'),
        p(schema, '嵌套的编号 2'),
      ]),
    ]),
    p(schema, '16B.5 嵌套：blockquote 内包含 bulletList：'),
    schema.node('blockquote', null, [
      p(schema, '引用内容'),
      schema.node('bulletList', null, [
        p(schema, '引用内的 bullet A'),
        p(schema, '引用内的 bullet B'),
      ]),
      p(schema, '引用继续'),
    ]),
    p(schema, '16B.6 嵌套：bulletList 内包含 bulletList（多级）：'),
    schema.node('bulletList', null, [
      p(schema, '一级 bullet'),
      schema.node('bulletList', null, [
        p(schema, '二级 bullet（应为 ◦）'),
        schema.node('bulletList', null, [
          p(schema, '三级 bullet（应为 ▪）'),
        ]),
      ]),
      p(schema, '回到一级'),
    ]),

    // ── 十七、Image 测试 ──
    heading(schema, 2, '十七、Image 测试'),
    p(schema, '17.1 下方是空图片占位符 → 点击"🖼 点击添加图片"上传：'),
    schema.node('image', { src: null, alt: '' }, [
      p(schema, ''),
    ]),
    p(schema, '17.2 上传后图片应居中显示'),
    p(schema, '17.3 图片下方 caption 可以编辑（支持格式化）'),
    p(schema, '17.4 SlashMenu 输入 /image → 创建新的 Image Block'),
    p(schema, ''),

    // ── 十八、Markdown 输入规则测试 ──
    heading(schema, 2, '十八、Markdown 输入规则测试'),
    p(schema, '在下方空行行首输入以下内容（含末尾空格），验证自动转换：'),
    p(schema, ''),
    p(schema, '18.1  # + 空格 → Heading 1'),
    p(schema, '18.2  ## + 空格 → Heading 2'),
    p(schema, '18.3  ### + 空格 → Heading 3'),
    p(schema, '18.4  - + 空格 → Bullet List（* + 空格 同效）'),
    p(schema, '18.5  1. + 空格 → Ordered List'),
    p(schema, '18.6  [] + 空格 → Task List（未勾选）'),
    p(schema, '18.7  [ ] + 空格 → Task List（未勾选，带空格）'),
    p(schema, '18.8  [x] + 空格 → Task List（已勾选）'),
    p(schema, '18.9  > + 空格 → Blockquote'),
    p(schema, '18.10  ``` → Code Block（输入三个反引号，无需空格）'),
    p(schema, '18.11  --- → Horizontal Rule（输入三个减号，无需空格）'),
    p(schema, ''),
    p(schema, '验证要点：'),
    p(schema, '• 转换后光标应在新 Block 内，可以立即输入'),
    p(schema, '• Cmd+Z 可以撤销转换，恢复为原始文本'),
    p(schema, '• 在非空行输入不触发（只有行首触发）'),

    // ── 十九、Table 测试 ──
    heading(schema, 2, '十九、Table 测试'),
    p(schema, '19.1 下方是预置的 3×3 表格：'),
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
      schema.node('tableRow', null, [
        schema.node('tableCell', null, [p(schema, '数据 4')]),
        schema.node('tableCell', null, [p(schema, '数据 5')]),
        schema.node('tableCell', null, [p(schema, '数据 6')]),
      ]),
    ]),
    p(schema, '19.2 Tab → 跳到下一个单元格，Shift+Tab → 上一个'),
    p(schema, '19.3 在单元格内可以输入多行内容（Enter 换行）'),
    p(schema, '19.4 SlashMenu 输入 /table → 创建新表格'),
    p(schema, ''),

    // ── 二十、Marks 扩展测试 ──
    heading(schema, 2, '二十、Marks 扩展测试'),
    p(schema, '20.1 textStyle（文字颜色）— 待 FloatingToolbar 颜色选择器'),
    p(schema, '20.2 highlight（背景高亮）— 待 FloatingToolbar 高亮选择器'),
    p(schema, '20.3 已注册到 Schema，可通过代码设置：'),
    // 预置带 highlight 的文字
    schema.node('textBlock', null, [
      text(schema, '20.4 这段文字有 '),
      schema.text('黄色高亮', [schema.marks.highlight.create({ color: 'yellow' })]),
      text(schema, ' 和 '),
      schema.text('蓝色高亮', [schema.marks.highlight.create({ color: 'blue' })]),
      text(schema, ' 和 '),
      schema.text('红色文字', [schema.marks.textStyle.create({ color: '#ff5252' })]),
      text(schema, '。'),
    ]),

    // ── 二十一、NoteLink 测试 ──
    heading(schema, 2, '二十一、NoteLink 测试'),
    p(schema, '21.1 SlashMenu 输入 /link 或 /note → 选择 "Link to Note"'),
    p(schema, '21.2 弹出搜索面板 → 输入关键词过滤 → 方向键选择 → Enter 插入'),
    p(schema, '21.3 插入后显示 📄 链接标签'),
    p(schema, '21.4 点击链接 → 打开目标笔记'),
    p(schema, '21.5 在下方用 /link 测试：'),
    p(schema, ''),

    // ── 二十二、Math Block 测试 ──
    heading(schema, 2, '二十二、Math Block 测试'),
    p(schema, '22.1 下方是预置的数学公式（点击可编辑）：'),
    schema.node('mathBlock', { latex: 'E = mc^2' }),
    schema.node('mathBlock', { latex: '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}' }),
    p(schema, '22.2 点击公式 → 进入编辑模式（LaTeX 输入）'),
    p(schema, '22.3 点击外部 → 返回预览模式（KaTeX 渲染）'),
    p(schema, '22.4 Escape → 退出编辑'),
    p(schema, '22.5 SlashMenu 输入 /math → 创建新公式'),
    p(schema, ''),

    // ── 二十三、Math Inline 测试 ──
    heading(schema, 2, '二十三、Math Inline 测试'),
    schema.node('textBlock', null, [
      text(schema, '23.1 行内公式示例：'),
      schema.nodes.mathInline.create({ latex: 'a^2 + b^2 = c^2' }),
      text(schema, ' 嵌入在文字中'),
    ]),
    schema.node('textBlock', null, [
      text(schema, '23.2 另一个：'),
      schema.nodes.mathInline.create({ latex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' }),
    ]),
    p(schema, '23.3 点击公式 → 弹出编辑框'),
    p(schema, '23.4 SlashMenu 输入 /inline → 创建行内公式'),
    p(schema, ''),

    // ── 二十四、Column List 测试 ──
    heading(schema, 2, '二十四、Column List 测试'),
    p(schema, '24.1 下方是预置的两列布局：'),
    schema.node('columnList', { columns: 2 }, [
      schema.node('column', null, [
        p(schema, '左列内容'),
        p(schema, '可以包含多个段落'),
      ]),
      schema.node('column', null, [
        p(schema, '右列内容'),
        p(schema, '也可以嵌套其他 Block'),
      ]),
    ]),
    p(schema, '24.2 下方是三列布局：'),
    schema.node('columnList', { columns: 3 }, [
      schema.node('column', null, [p(schema, '第一列')]),
      schema.node('column', null, [p(schema, '第二列')]),
      schema.node('column', null, [p(schema, '第三列')]),
    ]),
    p(schema, '24.3 SlashMenu 输入 /column → 创建分栏'),
    p(schema, ''),

    // ── 二十五、Frame Block 测试 ──
    heading(schema, 2, '二十五、Frame Block 测试'),
    p(schema, '25.1 下方是预置的彩框（点击左侧边框切换颜色）：'),
    schema.node('frameBlock', { color: 'blue' }, [
      p(schema, '蓝色边框内容'),
      p(schema, '可以包含多个段落和其他 Block'),
    ]),
    schema.node('frameBlock', { color: 'red' }, [
      p(schema, '红色边框内容'),
    ]),
    schema.node('frameBlock', { color: 'green' }, [
      p(schema, '绿色边框内容'),
    ]),
    p(schema, '25.2 SlashMenu 输入 /frame → 创建新彩框'),
    p(schema, ''),

    // ── 二十六、Audio Block 测试 ──
    heading(schema, 2, '二十六、Audio Block 测试'),
    p(schema, '26.1 下方是空音频占位符 → 点击上传音频文件：'),
    schema.node('audioBlock', { src: null }, [p(schema, '')]),
    p(schema, '26.2 上传后显示播放器控件'),
    p(schema, '26.3 SlashMenu 输入 /audio → 创建新音频'),
    p(schema, ''),

    // ── 二十七、Video Block 测试 ──
    heading(schema, 2, '二十七、Video Block 测试'),
    p(schema, '27.1 下方是空视频占位符 → 点击输入 URL：'),
    schema.node('videoBlock', { src: null }, [p(schema, '')]),
    p(schema, '27.2 支持 YouTube、Vimeo URL 和直链 mp4'),
    p(schema, '27.3 SlashMenu 输入 /video → 创建新视频'),
    p(schema, ''),

    // ── 二十八、Tweet Block 测试 ──
    heading(schema, 2, '二十八、Tweet Block 测试'),
    p(schema, '28.1 下方是空推文占位符 → 点击输入 URL：'),
    schema.node('tweetBlock', { tweetUrl: null }, [p(schema, '')]),
    p(schema, '28.2 输入 Twitter/X URL 后显示预览'),
    p(schema, '28.3 SlashMenu 输入 /tweet → 创建新推文'),
    p(schema, ''),

    // 底部空行
    p(schema, ''),
  ]);
}

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
  return schema.node('paragraph', null, content ? [text(schema, content)] : []);
}

function heading(schema: Schema, level: number, content: string): PMNode {
  return schema.node('heading', { level }, [text(schema, content)]);
}

export function buildTestDocument(schema: Schema): PMNode {
  return schema.node('doc', null, [
    // 标题
    schema.node('noteTitle', null, [text(schema, 'NoteView 测试文档')]),

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

    // 底部空行
    p(schema, ''),
  ]);
}

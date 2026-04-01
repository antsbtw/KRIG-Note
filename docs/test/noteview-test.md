# NoteView 测试文档

> 每次启动应用后，按以下清单逐条测试。不通过的项目截图反馈。

---

## 一、noteTitle（文档标题）

- [ ] 1.1 空标题显示 "Untitled" placeholder
- [ ] 1.2 输入标题文字 → 大字号显示，placeholder 消失
- [ ] 1.3 标题末尾按 Enter → 光标跳到下方 paragraph（不在标题内换行）
- [ ] 1.4 连续按 Enter → 全部创建 paragraph（不创建第二个 noteTitle）
- [ ] 1.5 空标题按 Backspace → 不删除（保持 placeholder）
- [ ] 1.6 Handle 不出现在 noteTitle 上
- [ ] 1.7 右键 noteTitle → 只有 Cut/Copy/Paste（无 Delete/Indent）

---

## 二、paragraph（段落）

- [ ] 2.1 输入文字 → 正常显示
- [ ] 2.2 回车 → 创建新 paragraph
- [ ] 2.3 空 paragraph 按 Backspace → 删除该 paragraph，光标移到上方
- [ ] 2.4 Handle 出现在 paragraph 左侧
- [ ] 2.5 Handle 菜单显示：Turn into Heading / Turn into Code Block / Turn into Quote / Delete

---

## 三、Mark 格式化

- [ ] 3.1 选中文字 → FloatingToolbar 出现（B I U S <>）
- [ ] 3.2 点击 B → 文字加粗（按钮蓝色高亮）
- [ ] 3.3 点击 I → 文字斜体
- [ ] 3.4 点击 U → 文字下划线
- [ ] 3.5 点击 S → 文字删除线
- [ ] 3.6 点击 <> → 文字行内代码
- [ ] 3.7 Cmd+B 快捷键 → 加粗
- [ ] 3.8 Cmd+I 快捷键 → 斜体
- [ ] 3.9 Cmd+U 快捷键 → 下划线
- [ ] 3.10 Cmd+E 快捷键 → 行内代码
- [ ] 3.11 codeBlock 中选中文字 → FloatingToolbar 不出现（marks=[]）

---

## 四、SlashMenu

- [ ] 4.1 空行输入 / → SlashMenu 弹出
- [ ] 4.2 菜单显示：Paragraph / Code Block / Bullet List / Numbered List / Quote / Divider
- [ ] 4.3 方向键 ↑/↓ → 选中项高亮移动
- [ ] 4.4 Enter → 执行选中项（如选 Code Block → 当前行变为 codeBlock）
- [ ] 4.5 Escape → 关闭 SlashMenu
- [ ] 4.6 输入 /code → 过滤显示 Code Block
- [ ] 4.7 输入 /list → 过滤显示 Bullet List 和 Numbered List

---

## 五、Handle 菜单

- [ ] 5.1 鼠标悬停 paragraph → Handle（⠿）出现在左侧
- [ ] 5.2 鼠标移开 → Handle 消失
- [ ] 5.3 点击 Handle → 操作菜单弹出
- [ ] 5.4 点击 Delete → paragraph 被删除
- [ ] 5.5 点击 Turn into Heading → paragraph 变为 heading
- [ ] 5.6 点击 Turn into Code Block → paragraph 变为 codeBlock
- [ ] 5.7 点击 Turn into Quote → paragraph 变为 blockquote
- [ ] 5.8 noteTitle 上不出现 Handle

---

## 六、Block Selection（ESC 选中）

- [ ] 6.1 在 paragraph 中按 ESC → Block 蓝色高亮，光标消失
- [ ] 6.2 再按 ESC → 取消选中，恢复编辑
- [ ] 6.3 选中后 Shift+↓ → 扩展选中到下一个 Block
- [ ] 6.4 选中后 Shift+↑ → 扩展选中到上一个 Block
- [ ] 6.5 选中后按 Delete → 删除选中的 Block
- [ ] 6.6 选中后左键单击 → 取消选中
- [ ] 6.7 选中后输入字符 → 取消选中，开始编辑
- [ ] 6.8 选中后方向键 → 取消选中

---

## 七、ContextMenu（右键菜单）

### 未选中状态（文字操作）

- [ ] 7.1 右键 → 显示 Cut / Copy / Paste（3 项）
- [ ] 7.2 选中文字后右键 → FloatingToolbar 隐藏，ContextMenu 显示
- [ ] 7.3 Cut → 剪切选中文字
- [ ] 7.4 Copy → 复制选中文字
- [ ] 7.5 Paste → 粘贴文字

### 选中 Block 状态（Block 操作）

- [ ] 7.6 ESC 选中 Block → 右键 → 显示 Cut/Copy/Paste + Delete/Indent/Outdent（6 项）
- [ ] 7.7 Block 选中保持（右键不取消选中）
- [ ] 7.8 Cut → Block 被剪切（从文档中移除）
- [ ] 7.9 Copy → Block 被复制（文档不变）
- [ ] 7.10 Paste → 剪贴板中的 Block 粘贴到当前位置
- [ ] 7.11 Delete → 选中的 Block 被删除
- [ ] 7.12 点击菜单外 → ContextMenu 关闭

---

## 八、菜单互斥

- [ ] 8.1 选中文字 → FloatingToolbar 出现
- [ ] 8.2 右键 → FloatingToolbar 消失，ContextMenu 出现
- [ ] 8.3 ContextMenu 关闭后 → FloatingToolbar 恢复（如果仍有文字选中）

---

## 九、enterBehavior（Enter 行为）

- [ ] 9.1 noteTitle 按 Enter → 跳到 paragraph（action: exit, always）
- [ ] 9.2 paragraph 按 Enter → 分裂为两个 paragraph（默认 split）
- [ ] 9.3 codeBlock 按 Enter → 换行（action: newline）
- [ ] 9.4 codeBlock 末尾连按两次 Enter → 退出到 paragraph（exitCondition: double-enter）
- [ ] 9.5 空 blockquote 子节点按 Enter → 退出引用（exitCondition: empty-enter）

---

## 十、heading（H1-H3）

- [ ] 10.1 SlashMenu 中没有单独的 "Heading" 项（按级别注册，待实现）
- [ ] 10.2 Handle 菜单 Turn into Heading → paragraph 变为 H1
- [ ] 10.3 heading 字号：H1 > H2 > H3
- [ ] 10.4 heading 按 Enter → 创建 paragraph（不延续 heading）

---

## 十一、codeBlock（代码块）

- [ ] 11.1 SlashMenu 选 Code Block → 创建 codeBlock
- [ ] 11.2 等宽字体显示
- [ ] 11.3 内部按 Enter → 换行（不创建新 Block）
- [ ] 11.4 末尾连按两次 Enter → 退出到 paragraph
- [ ] 11.5 FloatingToolbar 不出现（marks=[]）

---

## 十二、blockquote（引用）

- [ ] 12.1 SlashMenu 选 Quote → 创建 blockquote
- [ ] 12.2 左侧竖线显示
- [ ] 12.3 内部按 Enter → 在引用内创建新 paragraph
- [ ] 12.4 空行按 Enter → 退出引用

---

## 十三、horizontalRule（分割线）

- [ ] 13.1 SlashMenu 选 Divider → 创建水平线
- [ ] 13.2 水平线显示
- [ ] 13.3 不可编辑（光标不能进入）

---

## 十四、bulletList / orderedList（列表）

- [ ] 14.1 SlashMenu 选 Bullet List → 创建无序列表
- [ ] 14.2 SlashMenu 选 Numbered List → 创建有序列表
- [ ] 14.3 列表项内按 Enter → 创建新列表项
- [ ] 14.4 空列表项按 Enter → 退出列表
- [ ] 14.5 Tab → 缩进（嵌套子列表）
- [ ] 14.6 Shift+Tab → 减少缩进

---

## 十五、Undo/Redo

- [ ] 15.1 Cmd+Z → 撤销上一步操作
- [ ] 15.2 Cmd+Shift+Z → 重做
- [ ] 15.3 删除 Block 后 Cmd+Z → Block 恢复

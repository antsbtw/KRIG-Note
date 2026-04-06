import type { Schema, Node as PMNode } from 'prosemirror-model';

/**
 * 测试文档 — 按设计文档逐项验证
 *
 * 对照 docs/block/base/ 三基类契约，覆盖所有功能点。
 * 通过 Help → Load Test Document 加载。
 */

function text(schema: Schema, str: string): PMNode { return schema.text(str); }
function p(schema: Schema, content?: string): PMNode {
  return schema.node('textBlock', null, content ? [text(schema, content)] : []);
}
function heading(schema: Schema, level: number, content: string): PMNode {
  return schema.node('textBlock', { level }, [text(schema, content)]);
}
function mathBlock(schema: Schema, latex: string): PMNode {
  return schema.node('mathBlock', null, latex ? [text(schema, latex)] : []);
}

export function buildTestDocument(schema: Schema): PMNode {
  return schema.node('doc', null, [
    schema.node('textBlock', { isTitle: true }, [text(schema, '三基类架构 — 测试文档')]),

    // ════════════════════════════════════════════════════════
    // 一、TextBlock 基类
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '一、TextBlock 基类'),

    heading(schema, 2, '1.1 Heading 级别'),
    heading(schema, 1, 'H1 标题（30px 700）'),
    heading(schema, 2, 'H2 标题（24px 600）'),
    heading(schema, 3, 'H3 标题（20px 600）'),
    p(schema, '普通段落（16px normal）'),
    p(schema, '测试：Cmd+Alt+1/2/3 切换标题，Cmd+Alt+0 转回文本'),

    heading(schema, 2, '1.2 noteTitle'),
    p(schema, '• 文档首行 40px 大标题'),
    p(schema, '• 清空标题 → 显示 Untitled placeholder'),
    p(schema, '• 不可删除、不可拖拽'),

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

    heading(schema, 2, '1.4 Inline 节点'),
    schema.node('textBlock', null, [
      text(schema, 'hardBreak 测试（Shift+Enter）：第一行'),
      schema.nodes.hardBreak.create(),
      text(schema, '第二行（同一个 paragraph）'),
    ]),
    p(schema, '行内公式：选中文字 → FloatingToolbar ∑ 按钮，或 /math'),

    heading(schema, 2, '1.5 键盘行为'),
    p(schema, '• Enter：光标中间 → 分裂；末尾 → 新行；空行 → 新行'),
    p(schema, '• Backspace：空行 → 删除；行首 → 与上行合并'),
    p(schema, '• Shift+Enter → hardBreak（软换行）'),
    p(schema, '• Tab → indent +1，Shift+Tab → indent -1'),

    heading(schema, 2, '1.6 缩进测试'),
    p(schema, '在下方段落按 Tab 测试缩进（最多 8 级），Shift+Tab 反缩进：'),
    schema.node('textBlock', { indent: 0 }, [text(schema, 'indent 0（默认）')]),
    schema.node('textBlock', { indent: 1 }, [text(schema, 'indent 1')]),
    schema.node('textBlock', { indent: 2 }, [text(schema, 'indent 2')]),
    schema.node('textBlock', { indent: 3 }, [text(schema, 'indent 3')]),
    p(schema),

    heading(schema, 2, '1.7 Markdown 快捷输入'),
    p(schema, '在空行行首输入以下内容（含末尾空格）：'),
    p(schema, '# → H1 / ## → H2 / ### → H3'),
    p(schema, '- 或 * → bulletList / 1. → orderedList'),
    p(schema, '[] → taskList / > → blockquote'),
    p(schema, '``` → codeBlock / --- → horizontalRule'),
    p(schema, '在下方空行测试：'),
    p(schema),

    // ════════════════════════════════════════════════════════
    // 二、ContainerBlock 基类
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '二、ContainerBlock 基类'),

    heading(schema, 2, '2.1 bulletList'),
    schema.node('bulletList', null, [
      p(schema, '无序列表项 1'),
      p(schema, '无序列表项 2'),
      p(schema, '无序列表项 3'),
    ]),
    p(schema, '测试：Tab 嵌套 / Shift+Tab 提升 / Enter 新行 / 空行 Enter 退出'),

    heading(schema, 2, '2.2 orderedList'),
    schema.node('orderedList', null, [
      p(schema, '有序步骤一'),
      p(schema, '有序步骤二'),
      p(schema, '有序步骤三'),
    ]),
    p(schema, '测试：Tab 嵌套 / 编号自动递增 / Enter 新行 / 空行 Enter 退出'),

    heading(schema, 2, '2.3 taskList'),
    schema.node('taskList', null, [
      schema.node('taskItem', { checked: false, createdAt: new Date().toISOString() }, [p(schema, '任务一：点击 checkbox 打勾')]),
      schema.node('taskItem', { checked: true, createdAt: '2026-04-01T00:00:00Z', completedAt: new Date().toISOString() }, [p(schema, '任务二（已完成）')]),
      schema.node('taskItem', { checked: false, createdAt: new Date().toISOString(), deadline: '2026-04-10T00:00:00Z' }, [p(schema, '任务三（有截止日期，hover 查看）')]),
    ]),
    p(schema, '测试：checkbox 打勾 / 完成时间 / hover 时间标签 / 点击设置 deadline'),

    heading(schema, 2, '2.4 blockquote'),
    schema.node('blockquote', null, [
      p(schema, '引用第一行'),
      p(schema, '引用第二行'),
    ]),

    heading(schema, 2, '2.5 callout'),
    schema.node('callout', { emoji: '💡' }, [
      p(schema, '这是一个提示框'),
      p(schema, '支持多行内容'),
    ]),

    heading(schema, 2, '2.6 toggleList'),
    schema.node('toggleList', { open: true }, [
      p(schema, '折叠列表标题（点击 ▾ 折叠）'),
      p(schema, '折叠的子内容 1'),
      p(schema, '折叠的子内容 2'),
    ]),

    heading(schema, 2, '2.7 frameBlock'),
    schema.node('frameBlock', { color: '#8ab4f8' }, [
      p(schema, '蓝色边框内容'),
      p(schema, '点击左侧边框切换颜色'),
    ]),

    heading(schema, 2, '2.9 Container 嵌套'),
    schema.node('callout', { emoji: '🔥' }, [
      p(schema, '提示框 → 内嵌 bulletList'),
      schema.node('bulletList', null, [
        p(schema, '嵌套 bullet A'),
        p(schema, '嵌套 bullet B'),
      ]),
    ]),
    schema.node('bulletList', null, [
      p(schema, '一级 bullet（•）'),
      schema.node('bulletList', null, [
        p(schema, '二级 bullet（◦）'),
        schema.node('bulletList', null, [
          p(schema, '三级 bullet（▪）'),
        ]),
      ]),
    ]),

    heading(schema, 2, '2.10 列表缩进测试（P2/P3）'),
    p(schema, '在 bulletList 第 2 项按 Tab → 嵌套为子列表，Shift+Tab → 提升：'),
    schema.node('bulletList', null, [
      p(schema, '第一项（不可嵌套——是列表第一项）'),
      p(schema, '第二项：按 Tab 嵌套到第一项下'),
      p(schema, '第三项：按 Tab 嵌套'),
    ]),
    p(schema, '在 orderedList 中测试同样的 Tab 嵌套：'),
    schema.node('orderedList', null, [
      p(schema, '步骤一'),
      p(schema, '步骤二：按 Tab 嵌套'),
      p(schema, '步骤三'),
    ]),
    p(schema, '在 taskList 中测试 Tab 嵌套：'),
    schema.node('taskList', null, [
      schema.node('taskItem', { checked: false, createdAt: new Date().toISOString() }, [p(schema, '任务 A')]),
      schema.node('taskItem', { checked: false, createdAt: new Date().toISOString() }, [p(schema, '任务 B：按 Tab 嵌套')]),
      schema.node('taskItem', { checked: false, createdAt: new Date().toISOString() }, [p(schema, '任务 C')]),
    ]),

    heading(schema, 2, '2.11 SlashMenu 容器内嵌套（P5）'),
    p(schema, '在 orderedList 内输入 /bullet → 应在当前位置嵌套 bulletList：'),
    schema.node('orderedList', null, [
      p(schema, '步骤一'),
      p(schema, '步骤二：在此输入 /bullet 测试嵌套'),
      p(schema, '步骤三'),
    ]),
    p(schema),

    // ════════════════════════════════════════════════════════
    // 三、RenderBlock / 独立 Block
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '三、RenderBlock / 独立 Block'),

    heading(schema, 2, '3.1 codeBlock'),

    heading(schema, 3, '3.1.1 创建'),
    p(schema, '• 空行输入 ``` → 转为 codeBlock'),
    p(schema, '• SlashMenu /code → 创建 codeBlock'),
    p(schema, '• SlashMenu /mermaid → 创建 language=mermaid 的 codeBlock'),
    p(schema, '在下方空行测试 ``` 和 /code：'),
    p(schema),

    heading(schema, 3, '3.1.2 键盘行为'),
    schema.node('codeBlock', { language: 'javascript' }, [
      schema.text('// 在此测试键盘行为\nfunction hello() {\n  console.log("world");\n}'),
    ]),
    p(schema, '• Enter → 插入换行（不创建新 block）'),
    p(schema, '• 双 Enter 退出 → 在代码末尾连按两次 Enter → 退出到新 textBlock'),
    p(schema, '• Tab → 插入 2 个空格（代码缩进，不是 block 视觉缩进）'),
    p(schema, '• Shift+Tab → 删除行首 2 个空格（反缩进）'),
    p(schema, '• Backspace（空 codeBlock）→ 替换为 textBlock'),

    heading(schema, 3, '3.1.3 语言选择器'),
    schema.node('codeBlock', { language: 'python' }, [
      schema.text('# hover 显示 toolbar → 点击语言名切换\nprint("hello")'),
    ]),
    p(schema, '• hover codeBlock → 顶部 toolbar 显示'),
    p(schema, '• 点击语言名（如 python）→ 弹出输入框 + 下拉列表'),
    p(schema, '• 输入关键字过滤 / 点击选择 / Enter 确认 / Escape 取消'),

    heading(schema, 3, '3.1.4 复制按钮'),
    schema.node('codeBlock', { language: '' }, [
      schema.text('点击右上角 📋 按钮复制此代码'),
    ]),
    p(schema, '• hover → toolbar 右侧 📋 按钮 → 点击复制代码到剪贴板'),

    heading(schema, 3, '3.1.5 Mermaid 三模式'),
    schema.node('codeBlock', { language: 'mermaid' }, [
      schema.text('graph TD\n  A[开始] --> B{条件判断}\n  B -->|是| C[执行操作]\n  B -->|否| D[跳过]\n  C --> E[结束]\n  D --> E'),
    ]),
    p(schema, '• 分屏模式（默认）：左侧代码 + 右侧预览'),
    p(schema, '• 仅代码 / 仅预览 模式切换（toolbar 按钮）'),
    p(schema, '• 编辑代码 → 500ms debounce 自动刷新预览'),
    p(schema, '• 下载 PNG（2x retina）'),
    p(schema, '• 点击预览或全屏按钮 → 全屏查看（拖拽平移 + 滚轮缩放）'),
    p(schema, '• /code mermaid 或 /mermaid 创建'),

    heading(schema, 3, '3.1.6 HandleMenu'),
    schema.node('codeBlock', { language: 'rust' }, [
      schema.text('// 点击左侧手柄 ⠿ 测试菜单\nfn main() {}'),
    ]),
    p(schema, '• 手柄菜单 → "转为文本"（保留文本内容）'),
    p(schema, '• 手柄菜单 → "删除"'),

    heading(schema, 2, '3.2 mathBlock'),
    mathBlock(schema, 'E = mc^2'),
    mathBlock(schema, '\\int_{0}^{\\infty} e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}'),
    p(schema, '测试：点击编辑 LaTeX / Escape 退出 / 实时预览'),

    heading(schema, 2, '3.3 image / video / audio / tweet'),
    p(schema, '通过 SlashMenu 创建：/image /video /audio /tweet'),
    p(schema),

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

    heading(schema, 2, '4.3 columnList'),

    p(schema, '4.3.1 基础 2 列'),
    schema.node('columnList', { columns: 2 }, [
      schema.node('column', null, [p(schema, '左列内容'), p(schema, '可以包含多个段落')]),
      schema.node('column', null, [p(schema, '右列内容')]),
    ]),

    p(schema, '4.3.2 基础 3 列'),
    schema.node('columnList', { columns: 3 }, [
      schema.node('column', null, [p(schema, '第一列')]),
      schema.node('column', null, [p(schema, '第二列')]),
      schema.node('column', null, [p(schema, '第三列')]),
    ]),

    p(schema, '4.3.3 自定义列宽（30% / 70%）'),
    schema.node('columnList', { columns: 2 }, [
      schema.node('column', { verticalAlign: 'top', width: 30 }, [p(schema, '窄列 30%')]),
      schema.node('column', { verticalAlign: 'top', width: 70 }, [p(schema, '宽列 70%')]),
    ]),

    p(schema, '4.3.4 垂直对齐 — center'),
    schema.node('columnList', { columns: 2 }, [
      schema.node('column', { verticalAlign: 'center' }, [p(schema, '居中对齐')]),
      schema.node('column', { verticalAlign: 'center' }, [
        p(schema, '这列内容较多'),
        p(schema, '第二段'),
        p(schema, '第三段'),
      ]),
    ]),

    p(schema, '测试：hover 显示 toolbar（+/−/对齐），拖拽列间 handle 调整宽度'),

    // ════════════════════════════════════════════════════════
    // 五、Block Selection
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '五、Block Selection'),
    p(schema, '• ESC → 选中当前 block（蓝色高亮）'),
    p(schema, '• ↑/↓ → 导航到相邻 block'),
    p(schema, '• Shift+↑/↓ → 多选'),
    p(schema, '• Shift+Click → 范围选中'),
    p(schema, '• ← → 退出选中（←到首 block 开头，→到末 block 末尾）'),
    p(schema, '• Delete/Backspace → 删除选中 block'),
    p(schema, '• Cmd+C/X → 复制/剪切选中 block'),
    p(schema, '• Enter / 任意字符 → 退出选中并编辑'),

    heading(schema, 2, '5.1 批量缩进测试（P4）'),
    p(schema, '选中下方多个 block（ESC + Shift+↓），然后按 Tab 批量缩进：'),
    p(schema, '批量缩进 A'),
    p(schema, '批量缩进 B'),
    p(schema, '批量缩进 C'),
    p(schema, '批量缩进 D'),
    p(schema),

    // ════════════════════════════════════════════════════════
    // 六、Block Handle 拖拽
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '六、Block Handle 拖拽'),
    p(schema, '拖拽测试 A'),
    p(schema, '拖拽测试 B'),
    p(schema, '拖拽测试 C'),
    p(schema, '• 拖拽 ⠿ 按钮移动单个 block'),
    p(schema, '• ESC 多选 → 拖拽任一选中 block 的手柄 → 整体移动'),
    p(schema, '• 拖拽时蓝色对齐线显示落点'),
    p(schema),

    // ════════════════════════════════════════════════════════
    // 七、SlashMenu
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '七、SlashMenu'),
    p(schema, '在空行输入 / → 弹出菜单 → 方向键选择 → Enter 确认'),
    p(schema, '测试搜索：/h1 /bullet /code /math /table /image'),
    p(schema),

    // ════════════════════════════════════════════════════════
    // 八、Media Blocks（image / video / audio / tweet）
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '八、Media Blocks'),

    // ── 8.1 Image ──
    heading(schema, 2, '8.1 Image Block'),
    p(schema, '测试项目：'),
    p(schema, '• SlashMenu /image → 应出现 placeholder（Upload + Embed link 双按钮）'),
    p(schema, '• 点击 Upload → 文件选择器 → 选择图片 → 图片显示'),
    p(schema, '• 点击 Embed link → URL 输入框 → 粘贴图片 URL → Enter → 图片显示'),
    p(schema, '• hover 图片 → 对齐工具栏（◁ ▣ ▷）+ 左右 resize handles'),
    p(schema, '• 拖拽 resize handle → 按比例缩放'),
    p(schema, '• 点击对齐按钮 → 图片对齐切换（left / center / right）'),
    p(schema, '• 点击图片 → 蓝色选中边框（selectNode）'),
    p(schema, '• 选中后 Delete → 删除 block'),
    p(schema, '• 剪贴板粘贴图片 → 自动创建 image block（paste plugin）'),
    p(schema, '• caption 区域可编辑，支持 bold/italic 格式化'),

    // 实际的 image block（空，等用户上传）
    schema.node('image', { src: null }, [p(schema, '在这里测试 caption')]),
    p(schema),

    // ── 8.2 Audio ──
    heading(schema, 2, '8.2 Audio Block'),
    p(schema, '测试项目：'),
    p(schema, '• SlashMenu /audio → 应出现 placeholder（Upload + Embed link 双按钮）'),
    p(schema, '• Upload → 选择 .mp3/.ogg/.wav → 播放器显示'),
    p(schema, '• Embed link → 输入音频 URL → 播放器显示'),
    p(schema, '• 标题显示在播放器上方'),
    p(schema, '• hover 时右上角显示下载按钮 ⬇（仅 https:// URL）'),
    p(schema, '• 点击 ⬇ → 下载到本地 → URL 变为 media:// → 离线可用'),
    p(schema, '• 点击 block → 蓝色选中边框'),
    p(schema, '• 删除 block → audio 停止播放（destroy 清理）'),

    schema.node('audioBlock', { src: null, title: 'Test Audio' }, [p(schema, 'Audio caption')]),
    p(schema),

    // ── 8.3 Video ──
    heading(schema, 2, '8.3 Video Block'),
    p(schema, '测试项目（基础播放）：'),
    p(schema, '• SlashMenu /video → placeholder → 输入 YouTube/Vimeo/.mp4 URL'),
    p(schema, '• YouTube URL → iframe embed 自动检测'),
    p(schema, '• .mp4 URL → HTML5 <video> 播放器'),
    p(schema, '• Play / Data / Transcript 三 Tab 切换'),
    p(schema),
    p(schema, '测试项目（字幕系统）：'),
    p(schema, '• 点击 📝 → 导入 YouTube 字幕（InnerTube API）'),
    p(schema, '• Transcript Tab 显示 [MM:SS] text 格式'),
    p(schema, '• 点击 CC → 启用字幕浮层（视频底部半透明背景）'),
    p(schema, '• 点击 🌐 → 翻译字幕为中文（Google Translate 批量）'),
    p(schema),
    p(schema, '测试项目（学习功能）：'),
    p(schema, '• 点击 🧠 → Memory Playback Mode（分段进度条 A B C …）'),
    p(schema, '• 自动按 60s 分段，播完当前段 → 重复前段 + 新段'),
    p(schema, '• 点击 📖 → 右侧 Vocab Panel（词汇随播放时间滚动）'),
    p(schema, '• ⛶ → 全屏播放'),

    schema.node('videoBlock', { src: null }, [p(schema, 'Video caption')]),
    p(schema),

    // ── 8.4 Tweet ──
    heading(schema, 2, '8.4 Tweet Block'),
    p(schema, '测试项目：'),
    p(schema, '• SlashMenu /tweet → placeholder → 输入 twitter.com 或 x.com URL'),
    p(schema, '• 自动提取 Tweet ID → Browse Tab 显示 Twitter 官方 iframe embed'),
    p(schema, '• Browse / Data 双 Tab 切换'),
    p(schema, '• 点击 Fetch → 获取结构化数据（作者、正文、媒体、互动数据）'),
    p(schema, '• Data Tab 显示卡片（头像 + @handle + 正文 + 媒体网格 + 💬🔁❤👁）'),
    p(schema, '• "Open original ↗" → 系统浏览器打开原始推文'),

    schema.node('tweetBlock', { tweetUrl: null }, [p(schema, 'Tweet caption')]),
    p(schema),

    // ════════════════════════════════════════════════════════
    // 九、Paste Plugin
    // ════════════════════════════════════════════════════════
    heading(schema, 1, '九、Paste Plugin（图片粘贴）'),
    p(schema, '• 复制一张图片到剪贴板（截图或右键复制图片）'),
    p(schema, '• 在空行 Cmd+V → 空行被替换为 image block'),
    p(schema, '• 在有内容的行 Cmd+V → image block 插入到下一行'),
    p(schema, '• 粘贴普通文本不受影响（只拦截图片类型）'),
    p(schema),

    // 底部空行
    p(schema),
  ]);
}

# 媒体 Block 测试文档

> 对照 `docs/block/image.md`、`video-block.md`、`audio-block.md`、`tweet-block.md` 设计文档逐项验证。
> 通过 Help → Load Test Document 加载（测试文档第八、九节）。

---

## 一、Image Block

### 1.1 创建

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 1 | 空行输入 `/image` → 选择 Image | 插入 placeholder（🖼 + Upload + Embed link 两个按钮） | |
| 2 | 点击 Upload → 选择本地图片 | 图片显示，placeholder 消失 | |
| 3 | 新建 image → 点击 Embed link → 输入 URL → Enter | 图片显示 | |
| 4 | 复制图片到剪贴板 → 在空行 Cmd+V | 空行替换为 image block | |
| 5 | 在有内容的行 Cmd+V 图片 | image block 插入到下一行 | |

### 1.2 对齐与缩放

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 6 | hover 图片 | 上方出现对齐工具栏（◁ ▣ ▷），左右出现 resize handle | |
| 7 | 点击 ◁ (left) | 图片靠左对齐 | |
| 8 | 点击 ▣ (center) | 图片居中对齐 | |
| 9 | 点击 ▷ (right) | 图片靠右对齐 | |
| 10 | 拖拽右侧 resize handle | 图片按比例缩放，宽度更新 | |

### 1.3 选中与删除

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 11 | 点击图片区域 | 蓝色选中边框（`#8ab4f8`） | |
| 12 | 选中状态 → 按 Delete/Backspace | 删除整个 image block | |

### 1.4 Caption

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 13 | 点击 caption 区域 | 光标进入，可输入文字 | |
| 14 | caption 中 Cmd+B | 加粗格式生效 | |

---

## 二、Audio Block

### 2.1 创建

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 1 | `/audio` → 选择 Audio | 插入 placeholder（🎵 + Upload + Embed link） | |
| 2 | Upload → 选择 .mp3 文件 | 播放器显示，标题为文件名 | |
| 3 | Embed link → 输入音频 URL → Enter | 播放器显示 | |

### 2.2 播放器

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 4 | 查看已加载的 audio block | 标题显示在上方，`<audio controls>` 播放器 | |
| 5 | 点击播放按钮 | 音频播放正常 | |
| 6 | hover 播放器区域 | 右上角出现 ⬇ 下载按钮（仅 https:// URL） | |

### 2.3 下载本地化

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 7 | 点击 ⬇ 按钮 | 按钮变为 ⏳，下载完成变为 ✅ | |
| 8 | 检查 src attr | 变为 `media://audio/audio-{hash}.{ext}` | |
| 9 | 断网后播放 | 仍可播放（本地文件） | |

### 2.4 生命周期

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 10 | 正在播放 → 删除 block | 声音立即停止（destroy 清理） | |
| 11 | 点击 block → 蓝色选中边框 | selectNode 生效 | |

---

## 三、Video Block

### 3.1 基础播放

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 1 | `/video` → 输入 YouTube URL | YouTube iframe embed 加载 | |
| 2 | `/video` → 输入 Vimeo URL | Vimeo iframe embed 加载 | |
| 3 | `/video` → 输入 .mp4 URL | HTML5 `<video>` 播放器 | |
| 4 | Tab 栏有 Play / Data / Transcript 三个按钮 | 点击切换面板 | |

### 3.2 Action 按钮

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 5 | Tab 栏右侧有 CC 🧠 📝 🌐 📖 ⛶ 按钮 | 6 个 action 按钮可见 | |
| 6 | 点击 ⛶ | 全屏播放 | |

### 3.3 字幕系统

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 7 | YouTube 视频 → 点击 📝 | 下载字幕 → Transcript Tab 显示 `[MM:SS] text` | |
| 8 | 点击 CC | 播放时视频底部显示字幕浮层 | |
| 9 | 再次点击 CC | 字幕浮层隐藏 | |
| 10 | 在 Transcript Tab 手动编辑文本 | 字幕 cue 实时更新 | |

### 3.4 翻译

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 11 | 有字幕时 → 点击 🌐 | 翻译为中文，Translation 面板显示 | |
| 12 | 翻译文本保留时间戳 `[MM:SS]` 格式 | 时间戳对齐原文 | |

### 3.5 Memory Playback Mode

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 13 | 直接文件 `.mp4` → 点击 🧠 | 底部出现分段进度条 A B C … | |
| 14 | 播放到分段边界 | 自动切换到下一步（前段重复 + 新段） | |
| 15 | 再次点击 🧠 | 停止 Memory Mode，保存进度到 attrs | |

### 3.6 Vocab Panel

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 16 | 先在学习模块添加几个生词 | 生词列表有数据 | |
| 17 | 有字幕时 → 点击 📖 | 右侧出现词汇面板 | |
| 18 | 播放视频 | 词汇随播放时间滚动，当前词高亮 | |

### 3.7 Data Tab

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 19 | 有 metadata → 切换到 Data Tab | 显示标题/时长/作者/统计等卡片 | |
| 20 | 无 metadata → Data Tab | 显示 "No metadata available" | |

### 3.8 生命周期

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 21 | 正在播放 → 删除 block | 视频停止，定时器清除 | |
| 22 | Memory Mode → 删除 block | Memory 状态保存，定时器清除 | |

---

## 四、Tweet Block

### 4.1 创建

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 1 | `/tweet` → 输入 twitter.com URL → Enter | Tweet ID 提取，Browse Tab 显示 iframe embed | |
| 2 | 输入 x.com URL → Enter | 同上（支持新域名） | |
| 3 | 输入无效 URL → Enter | 显示 "Unable to parse tweet ID" | |

### 4.2 Browse Tab

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 4 | Browse Tab 加载 | Twitter embed iframe 正确显示（暗色主题） | |
| 5 | iframe 高度自适应 | postMessage resize 生效 | |

### 4.3 Data Tab + Fetch

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 6 | 点击 Fetch 按钮 | 按钮变为 ⏳，获取数据后自动切换到 Data Tab | |
| 7 | Data Tab 显示 | 头像 + 作者名 + @handle + 时间 | |
| 8 | 推文有图片 | 媒体网格显示图片 | |
| 9 | 互动数据 | 💬 🔁 ❤ 👁 数字格式化（1.2K, 5M） | |
| 10 | 点击 "Open original ↗" | 系统浏览器打开原始推文 | |

### 4.4 生命周期

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 11 | 删除 tweet block | postMessage listener 清理（destroy） | |
| 12 | 点击 block → 蓝色选中边框 | selectNode 生效 | |

---

## 五、通用能力（所有媒体 Block）

| # | 测试步骤 | 预期结果 | 通过 |
|---|---------|---------|------|
| 1 | hover 任意媒体 block | 顶部 toolbar 显示（label + 📋 复制按钮） | |
| 2 | 选中任意媒体 block（点击非 caption 区域） | 蓝色选中边框 | |
| 3 | 选中 → 点击其他位置 | 选中边框消失（deselectNode） | |
| 4 | 拖拽 block handle (⠿) | 媒体 block 整体移动 | |
| 5 | caption 区域输入文字 + 格式化 | 正常工作（ProseMirror 管理） | |

---

## 六、Phase 3 待验证（后续）

以下功能需等对应系统完成后再测试：

- [ ] **Thought 锚定**：需 thought-plugin + thought-commands 系统
- [ ] **Atom Converter**：需 Atom 持久化架构
- [ ] **Markdown 导出**：需 block-to-markdown 框架

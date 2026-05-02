# KRIG-Note L5 业务视图层（Note 笔记）架构评估与改造建议

> **核心原则重申**：
> 1. **上层不插手下层的业务**：L5 作为最底层的内容消费者，没有下层需要干预。
> 2. **下层不能干预上层的业务**：NotePlugin 只负责富文本渲染和处理自己的数据，绝不能越权去指挥 L4/L3 如何开分屏。

---

## 一、 现状评估

**主要涉及区域**：`src/plugins/note/`

### 1. 优秀设计：彻底的业务下沉
在最近的重构中，Note 相关的文件夹结构、拖拽逻辑、侧边栏渲染等已经成功从 `NavSide` 剥离，转移到了 `src/plugins/note/navside/` 下。Note 终于实现了“组件自治”，这完全符合分层与插件化原则。

### 2. 违规行为：试图越权当“总导演”
**代码证据**：
1. `src/plugins/note/navside/useNoteOperations.ts` 中，当用户点击某个笔记进行打开时，代码强行调用了 `navSideAPI.closeRightSlot()`。
2. `src/plugins/note/commands/ask-ai-command.ts` 中，当用户调用 AI 提问时，直接执行了 `await api.openCompanion('ai-web')` 和 `api.openCompanion('thought')`。

**评估结论**：**边界穿透**。Note 插件为了满足自己的 UX 需求（“打开笔记时要求清爽单屏”、“问 AI 时要求自动打开右侧面板”），不惜越权直接调用框架层的特权 API 操控布局。这就好比一个租客为了看电视，直接强行把旁边的一堵墙砸穿了。这种硬编码会导致不同插件之间的抢占冲突。

---

## 二、 改造建议（Refactoring Guide）

### 1. 废除命令式的布局调用，改为“声明式意图”
**要求**：剥夺 Note 插件的开窗特权。
- **修改点**：在 `useNoteOperations.ts` 和 `ask-ai-command.ts` 中，删除所有的 `closeRightSlot()` 和 `openCompanion()`。
- **新契约**：改为发送全局业务意图：
  ```typescript
  // 以前：我命令大楼关掉右边
  // void navSideAPI.closeRightSlot();
  
  // 现在：我发出一个通知，我只是打开了一篇笔记。怎么排版，听 Workspace 的
  dispatchEvent(new IntentEvent('content:opened', { type: 'note', id: noteId }));
  ```
  对于 `ask-ai` 也是同理，抛出 `intent:ai-assistance-requested` 即可，由上层的调度中心决定在哪儿把 AI 渲染出来。

**总结**：Note 的业务逻辑很扎实，只要把“手伸得太长”的布局控制权上交，就能成为一个完美的插件。

# View 协同协议 — 定义

> **前置**：本文档是 `view.md` 中 §八「View 之间的关系」的独立展开。
> 定义 View 间协同的协议类型、匹配规则和行为明细。

---

## 一、核心原则

1. **默认孤立**：任意两个 View 放入 Left + Right Slot，默认无协同
2. **查表匹配**：只有协同协议表中明确注册的 View 组合才启用协同行为
3. **协议不属于 View**：协同协议是两个 View 之间的关系，不是单个 View 的属性
4. **View 不知道对面**：View 不知道另一个 Slot 放了什么。协同行为由框架的协议层注入，View 只收发消息
5. **通信经过路由**：所有协同通信经过 main 进程路由

---

## 二、协议类型

| 协议 | 说明 | 方向 |
|------|------|------|
| **none** | 无协同（默认） | — |
| **translate** | 翻译同步：导航 + 滚动 + 点击 + 输入 + 翻译注入 | 双向（导航单向 Left→Right） |
| **anchor** | 锚点关联：点击跳转 + 滚动高亮 | 双向 |
| **page-sync** | 页码关联：翻页同步 + 页码跳转 | 双向 |

---

## 三、协同协议匹配表

协议由 **(Left View, Right View)** 的组合查表决定：

| Left View | Right View | 协议 | 场景 |
|-----------|------------|------|------|
| WebView | WebView | **translate** | 双屏翻译对照 |
| NoteView | NoteView:thought | **anchor** | 编辑 + 批注 |
| PDFView | NoteView:thought | **anchor** | 阅读 + 批注 |
| PDFView | NoteView | **page-sync** | PDF 提取到笔记 |
| NoteView | PDFView | **page-sync** | 编辑 + PDF 参考 |
| **其他所有组合** | | **none** | 默认无协同 |

### 3.1 匹配规则

```
用户操作导致 Slot 绑定变更
  → 框架查协同协议表
    → (leftView.type + variant, rightView.type + variant) 匹配
      → 匹配到 → 启用对应协议的行为集合
      → 未匹配 → none（什么都不做）
```

### 3.2 注册机制

协同协议也通过注册制声明，框架不硬编码匹配表：

```typescript
interface ProtocolRegistration {
  id: string;                    // 协议标识，如 'translate', 'anchor'
  match: ProtocolMatch;          // 匹配条件
  behaviors: ProtocolBehavior[]; // 行为集合
}

interface ProtocolMatch {
  left: { type: ViewType; variant?: string };
  right: { type: ViewType; variant?: string };
}
```

> 新增协同协议 = 注册一个新的 `ProtocolRegistration`，框架不改。

---

## 四、各协议行为明细

### 4.1 translate — 翻译同步

**适用组合**：WebView + WebView

全套同步行为，使右侧成为左侧的翻译镜像。

| 行为 | 触发 | 方向 | 说明 |
|------|------|------|------|
| **导航同步** | 左侧导航到新 URL | Left → Right | 左侧加载完成后，右侧加载同一 URL |
| **滚动同步** | 任一侧滚动 | 双向 | 鼠标所在侧驱动另一侧跟随 |
| **点击同步** | 任一侧点击非链接元素 | 双向 | 通过 CSS selector 匹配对应元素 |
| **输入同步** | 任一侧输入框输入 | 双向 | 同步输入内容 |
| **翻译注入** | 右侧页面加载完成 | 仅右侧 | 注入翻译引擎，自动翻译页面 |

**特征**：
- 这是唯一需要全套同步的协议
- 每种行为可独立开关（未来可能有"镜像同步但不翻译"的模式）

---

### 4.2 anchor — 锚点关联

**适用组合**：NoteView + NoteView:thought、PDFView + NoteView:thought

左侧主文档与右侧批注面板之间的锚点绑定关系。

| 行为 | 触发 | 方向 | 说明 |
|------|------|------|------|
| **锚点跳转** | 用户点击右侧 Thought 条目 | Right → Left | 左侧滚动到该 Thought 对应的锚点位置 |
| **可见区域同步** | 左侧滚动 | Left → Right | 右侧高亮当前可见区域对应的 Thought 条目 |

**特征**：
- 左侧不需要知道右侧存在。右侧通过 main 路由发送 `scrollTo(anchorId)`，左侧响应
- 左侧滚动时广播当前可见区域，右侧自行判断是否需要高亮

---

### 4.3 page-sync — 页码关联

**适用组合**：PDFView + NoteView、NoteView + PDFView

PDF 页码与 Note 内容之间的位置关联（基于提取时记录的源页码信息）。

| 行为 | 触发 | 方向 | 说明 |
|------|------|------|------|
| **PDF → Note 同步** | PDF 翻页 | Left → Right 或 Right → Left | Note 滚动到该页对应的提取内容 |
| **Note → PDF 跳转** | 用户点击 Note 中的页码引用 | 反向 | PDF 跳转到对应页 |

**特征**：
- 依赖 Note Block 上的 `sourcePages` 元数据（提取时写入）
- 无此元数据的 Block 不参与同步

---

## 五、协议生命周期

```
Slot 绑定变更（用户切换 WorkMode / 打开 Right Slot / 切换 Workspace）
  │
  ├── 1. 停用旧协议
  │     └── 清理旧协议的行为监听
  │
  ├── 2. 查匹配表
  │     └── (newLeft, newRight) → 协议类型
  │
  └── 3. 启用新协议（如果不是 none）
        └── 注册对应行为的监听
```

**不变量**：
- 同一时刻一个 Workspace 最多一个活跃协议
- 切换 Workspace 时，旧 Workspace 的协议停用，新 Workspace 的协议启用
- 协议的启停不影响 View 的内部状态

---

## 六、约束（不变量）

1. **默认 none**：未在匹配表中注册的 View 组合，一律无协同。新增 View 类型时无需修改任何排除逻辑
2. **协议不侵入 View**：协议层只做消息路由和行为注入，不修改 View 的内部状态或渲染逻辑
3. **行为可独立开关**：协议中的每种行为（导航同步、滚动同步等）可独立启用/禁用
4. **位置无关**：View 不知道自己在 Left 还是 Right Slot。协议层根据匹配表确定方向
5. **注册制**：框架不硬编码任何协议。所有协议通过注册接口声明

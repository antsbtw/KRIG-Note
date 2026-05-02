# F-12 ContextMenu 共享框架设计

**Status**:Draft (2026-05-02)
**Owner**:user / claude
**Track**:M3 共享 UI 层重构(从 ContextMenu 这一个抽出口先动手)

## 背景

KRIG 当前各 view 各做自己的 ContextMenu:

| view | 文件 | 现状 |
|---|---|---|
| **NoteView** | `src/plugins/note/components/ContextMenu.tsx` | 内置 30+ 条件 + actions(Cut/Copy/Paste + thought + frame + mark + 学习/AI),plugin 内部硬编码 |
| **Canvas (Graph)** | `src/plugins/graph/canvas/ui/ContextMenu/ContextMenu.tsx` | items 注入式,Canvas 自己 build items |
| **eBook / Web** | 无独立 ContextMenu | 用浏览器默认,或 viewer 内置 |

**问题**:
1. 视觉风格不一致(虽然 Canvas 已对齐 NoteView 的胶囊深色样式)
2. **注册分散**:Canvas 加新菜单项要改 `buildContextMenuItems`;NoteView 加新功能要动那 30+ 条件的大文件;两边都不能跨 view 共享
3. 通用项("Cut/Copy/Paste/Delete"等)在每个 view 重复实现
4. 子菜单互斥 / 视觉细节各自维护(F-12 触发 bug:Canvas Fill/Stroke 子菜单同时打开重叠)

**目标**:抽公共 ContextMenu 框架 + 注册式 contributions,各 view 接入,统一视觉 + 行为。

---

## 设计原则(用户提出)

1. **先抽象 NoteView 已完成的内容**:NoteView 的 ContextMenu 是项目里最成熟、功能最丰富的实现,**直接以它的能力 / 视觉为基准**反向抽公共框架
2. **分层 + 注册**:共享视觉层 + 注册中心 + 各 plugin contributors,不让任何一层知道太多
3. **NoteView 先迁移成功**:作为第一个使用者,**通过完整功能验证框架可行**(30+ 条件、子菜单、自定义 render 全经过)
4. **NoteView 通过后,其他 view 加入**:Canvas / eBook / Web 顺序接入,每加一个 view 验证一次抽象是否够

---

## 架构

```
┌─ src/shared/ui/ContextMenu (共享视觉组件层) ──────────────────┐
│  • <ContextMenu>:纯组件,接 items[] / position / onClose       │
│  • 处理:位置 + 视口边界 + 子菜单展开 / 互斥 + ESC + 外部点击关 │
│  • 不知道任何 view 数据;不读 PM,不读 Canvas inst             │
├─ src/shared/registry/contextMenuRegistry (注册中心) ──────────┤
│  • register(viewType, contributor)                            │
│  • collect(viewType, ctx) → 调所有 contributor 合并 items     │
│  • 顺序合并 + 自动加 separator                                │
├─ Plugin contributors(各自注册自己的项) ──────────────────────┤
│  • framework: 通用 (Cut/Copy/Paste,viewType='*')              │
│  • note: viewType='note' (mark/thought/frame/lookup/AI)       │
│  • graph: viewType='canvas' (Fill/Stroke/Color/Valign...)     │
│  • ebook / web:留接口,后续接                                 │
└───────────────────────────────────────────────────────────────┘
```

## 类型设计

```ts
// 通用 item 类型(supports 4 种)
type ContextMenuItem =
  | ActionItem
  | SubmenuItem
  | CustomItem
  | SeparatorItem;

interface ActionItem {
  id: string;
  label: string;
  icon?: string;          // emoji / SVG
  shortcut?: string;      // '⌘C' / 'Tab' 等显示在右侧
  disabled?: boolean;
  onClick: () => void;
}

interface SubmenuItem {
  id: string;
  label: string;
  icon?: string;
  items: ContextMenuItem[];   // 递归(子菜单可以再有子菜单)
}

interface CustomItem {
  id: string;
  /** 完全自定义 — 颜色 swatch、滑块等。close 由组件注入 */
  render: (close: () => void) => React.ReactNode;
}

interface SeparatorItem {
  id: string;
  separator: true;
}
```

## 注册中心

```ts
// shared/registry/contextMenuRegistry.ts
type Contributor<Ctx> = (ctx: Ctx) => ContextMenuItem[];

interface RegistryEntry {
  viewType: string;       // 'note' / 'canvas' / 'ebook' / 'web' / '*'
  priority: number;       // 决定 items 顺序;数值小先出
  contributor: Contributor<any>;
}

class ContextMenuRegistry {
  register<Ctx>(viewType: string, priority: number, contributor: Contributor<Ctx>): () => void;
  collect(viewType: string, ctx: unknown): ContextMenuItem[];
}

export const contextMenuRegistry = new ContextMenuRegistry();
```

**collect 合并规则**:
1. 取 `viewType` 匹配的所有 contributors + viewType=`'*'` 的通用 contributors
2. 按 priority 升序调每个 contributor → 合并 items
3. **自动 separator**:不同 contributor 之间自动加分隔线(若两边都非空且未结尾分隔)
4. **去重**:同 id 的 item 后注册者覆盖前注册者(允许 plugin 覆盖通用项)

## Context 不强类型

每个 viewType 自定义 context 形态:

```ts
// Canvas:
type CanvasMenuCtx = {
  selectedIds: string[];
  getInstance: (id: string) => Instance | undefined;
  view: 'canvas';
  callbacks: { onColorChange, onValignChange, onShapeStyle, ... };
};

// NoteView:
type NoteMenuCtx = {
  view: PMEditorView;
  selectionCache: SelectionCache;
  blockPositions: number[];
  view: 'note';
  ...
};
```

contributor 在自己 plugin 里强类型 cast,共享层只用 `unknown`。

## 子菜单互斥(子菜单视觉模型)

**问题**:F-5 触发的 bug — hover Fill 弹 popover,然后 hover Stroke 弹另一个 popover,Fill 没关。

**解法**:`<ContextMenu>` 自己管"当前展开的子菜单 id" — 任一时刻最多一个子菜单打开,hover 进新 item 时立即关旧的。

```tsx
const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);

// menu item 上:
onMouseEnter={() => {
  if (item.kind === 'submenu') setOpenSubmenuId(item.id);
  else setOpenSubmenuId(null);
}}
```

## 迁移路线

### Phase 1:抽象 + NoteView 迁移(本次 F-12)

1. **新建 `src/shared/ui/ContextMenu`**:
   - `ContextMenu.tsx` — 纯组件
   - `types.ts` — ContextMenuItem 等
   - `Submenu.tsx` — 子菜单组件(供 SubmenuItem 用)

2. **新建 `src/shared/registry/contextMenuRegistry.ts`** — 注册中心

3. **抽 NoteView 30+ 条件 → 多个 contributors**:
   - `note.contextmenu.basic.ts`:Cut/Copy/Paste/Delete(其实可以归 framework 通用层,但暂留 NoteView)
   - `note.contextmenu.indent.ts`:Indent/Outdent
   - `note.contextmenu.marks.ts`:移除粗体/斜体/.../链接(8 种 mark)
   - `note.contextmenu.thought.ts`:删除标注 / 添加标注
   - `note.contextmenu.frame.ts`:框定 + FramePicker 子菜单
   - `note.contextmenu.learning.ts`:查词 / 翻译
   - `note.contextmenu.ai.ts`:问 AI

4. **NoteView ContextMenu.tsx** 改为薄壳:
   ```tsx
   const items = contextMenuRegistry.collect('note', ctx);
   return <SharedContextMenu items={items} ... />;
   ```

5. **验收**:NoteView 所有原有功能都正常 — 30+ 条件覆盖到位

### Phase 2:Canvas 迁移(F-12 后续 commit)

把 Canvas 的 buildContextMenuItems 拆成 contributors:
- `canvas.contextmenu.shape-style.ts`:Fill / Stroke
- `canvas.contextmenu.text-style.ts`:Color(Sticky)/ Vertical Align
- `canvas.contextmenu.combine.ts`:Combine to Substance
- `canvas.contextmenu.delete.ts`:Delete

CanvasView 改用 `contextMenuRegistry.collect('canvas', ctx)`。

### Phase 3:eBook / Web 接入(可选,后期)

定义各自 contributor,接入。

## 范围控制

**F-12 第一次**(本次):仅做 Phase 1。
- 不动 Canvas 现有 ContextMenu
- 不修 F-5 子菜单互斥 bug(等 Phase 2 用新框架天然解决)
- NoteView 迁移完成 + 验收通过 = F-12 v1 完成

**F-12 第二次**:Phase 2(Canvas 迁移)。

**子菜单互斥 bug** 在新框架的 `<SharedContextMenu>` 里天然解决,不再各自维护。

## 风险

1. **NoteView ContextMenu 复杂度**:30+ 条件 + 大量副作用(thought IPC / frame attrs / lookup popup),拆 contributors 可能漏 case
   - **缓解**:Phase 1 完成后**功能完整测试**(光标在 link / thought / frame / 选中文本 / 多 block 选区 等场景全测)
2. **共享组件 z-index / 浮层冲突**:Canvas / NoteView 各自有 popup / FloatingToolbar,需要确认共享 ContextMenu 不被遮
   - **缓解**:Phase 1 用现有 z-index 1000,与 Canvas EditOverlay 1000 同级(若现有 NoteView 1000 也同级,问题已存在,不在 F-12 引入)
3. **类型放宽风险**:`collect(...)` 返回 `unknown` 让 contributor 自己 cast,如果 ctx 形状不一致会运行时崩
   - **缓解**:每个 viewType 文档化 ctx 形态;contributor 入口 type guard

## 不在 F-12 范围

- 注册式键盘快捷键(Cmd+X 等):由 view 自己处理,不统一
- 通用菜单**项**(Cut/Copy)抽到 framework 层:Phase 2/3 才做,Phase 1 先让 NoteView 自己注册
- ContextMenu**主题**(浅 / 深主题):用 CSS 变量,但 F-12 不引入主题切换

## 决议(待 user 确认)

- ✅ 同意"NoteView 先迁,验收后其他 view 接入"分阶段路径
- ✅ Phase 1 仅抽框架 + NoteView 迁移,不动 Canvas
- ✅ 类型 4 种(Action / Submenu / Custom / Separator),context 不强类型
- ✅ 子菜单互斥由共享组件管(组件级 state)
- 待定:Phase 1 是否同时把"Cut/Copy/Paste/Delete" 抽到 framework 通用层?(我建议**留 NoteView 内**,Phase 1 只关心抽离机制,Phase 2/3 再考虑通用化)

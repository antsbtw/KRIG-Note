# Canvas M1 验收测试

**测试日期填**:____________

**分支**:`feature/graph-canvas-m1`

**测试前置**:
1. 在仓库根目录运行 `npm start`,等 9 个 Vite dev server 全部就绪 + Electron 启动
2. 进入应用后,顶部 WorkspaceBar 应能看到一个 🎨 Graph 图标(第 5 顺位)
3. 切到 Graph workMode

---

## 验收范围

§2.1 共 14 项;M1.6 之前先验 **1-12 + 14**(第 13 "Edit Substance via API" 留 M1.6 完成后再验)。

| 项目 | 入口 | 状态 |
|---|---|---|
| 1 | NavSide "+ 新建画板" → 创建 + 自动打开 | M1.5b 应过 |
| 2 | 浏览 Library 工具栏 → 看到 22 shape + 5 substance | M1.4b 应过 |
| 3 | 点 shape 工具 → 画布点击 → 实例化 | M1.3c + M1.4b 应过 |
| 4 | 点 substance 工具 → 画布点击 → 实例化 | 同上 |
| 5 | 单击节点 → 高亮 + Inspector 显示属性 | M1.3a + M1.4c |
| 6 | Inspector 改 fill/line/size → 视觉立即更新 | M1.4c |
| 7 | 拖动节点 → 节点跟随 + line 自动跟随 | M1.3a + M1.2c |
| 8 | 选中按 Delete → 节点 + 引用 line 一起删 | M1.3a |
| 9 | 滚轮 → 画板缩放 | M1.3b |
| 10 | 拖动空白 → 画板平移 | M1.3b |
| 11 | 关闭 Canvas → 重打开 → 内容完整恢复 | M1.5b.6 |
| 12 | 多选 + Combine → 弹对话框 → 创建新 substance | M1.4d |
| 13 | 选中 substance → Edit Substance → right-slot 编辑 | M1.6 之后再验 ⏸ |
| 14 | 创建 line,两端 magnet 自动吸附 shape | M1.2c(部分,见下文) |

---

## 测试用例

### Test 1:NavSide "+ 新建画板"

**步骤**:
1. 切到 Graph workMode(WorkspaceBar 🎨 图标)
2. NavSide 顶部应看到 "画板目录" + 两个按钮 `+ 文件夹` `+ 画板`
3. 点 `+ 画板`

**预期**:
- 列表里立即出现一条新画板,默认名 `未命名画板`,自动进入重命名状态
- 输入新名字 + Enter → 列表项标题更新
- 单击列表项 → CanvasView 打开,toolbar 标题显示该画板名

**失败迹象**:
- ❌ 点击 `+ 画板` 列表无反应 → 检查 `'navside:action'` 事件
- ❌ 列表项创建了但单击没反应 → 检查 `graphOpenInView` IPC
- ❌ CanvasView 显示但 toolbar 标题还是 'Canvas' → loadGraph 没跑或没同步 graphTitle

---

### Test 2:Library Picker

**步骤**:
1. 在已打开的画板里,点 toolbar 的 `+ Shape` 按钮
2. 应弹出双栏 popover:左侧分类(Basic / Arrow / Flowchart / Line / Text),右侧 3-col 网格

**预期**:
- 左侧 5 个分类,各有 count 数字(Basic 11 / Arrow 3 / Flowchart 4 / Line 3 / Text 1)
- 切到 Arrow 分类 → 右侧网格显示 3 个箭头缩略图
- 点 toolbar `◇ Substance` → popover 切到 Substance 分类(Library 2 / Family 3)
- 顶部搜索框输入 "rect" → 跨分类显示 roundRect / rect / 等
- ESC / 点外部 → popover 关闭

**失败迹象**:
- ❌ Picker 不打开 → handleAddShape 没传 anchorRect
- ❌ 分类列表为空 → ShapeRegistry.bootstrap 没跑
- ❌ 缩略图全是空白 / 全是占位 → preview-svg.ts 出错

---

### Test 3:实例化 Shape

**步骤**:
1. 点 toolbar `+ Shape` → 选 `Rounded Rectangle`
2. 光标应变 crosshair,toolbar 下方提示 "点击画布放置 · ESC 取消"
3. 在画布空白处单击

**预期**:
- 实例化一个 roundRect(默认 160×100,以点击位置为中心)
- 自动选中(显示蓝色矩形选区线框)
- 光标恢复正常,提示消失
- 数据持久化:1 秒后 graphSave 应已写盘(toolbar 标题尾的 `•` 脏标记应该出现然后消失)

**失败迹象**:
- ❌ 点画布无反应 → addMode 状态没正确进入
- ❌ 形状出现但选中未自动 → placeInstance 内 setSelection 漏了
- ❌ 标题永远 `•`(脏)不消 → flushSave 失败,看 console 错误

---

### Test 4:实例化 Substance

**步骤**:
1. 点 toolbar `+ 添加` → 左栏切到 `Family` 分类 → 选 `Family Person`
2. 在画布空白处单击

**预期**:
- 实例化一个 family.person substance(roundRect frame + 2 行 label)
- frame 默认浅蓝色(gender='M' 默认 #a8c7e8 — 但 v1 props 没接通,可能显示默认 #4A90E2)

**已知限制**:
- substance 的 visual_rules(gender → 颜色)v1 没接通(M1 范围内 substance 实例的 props 没有 UI 输入)

---

### Test 5:Inspector 改属性

**步骤**:
1. **单击**一个已存在的 shape 实例(Test 3 创建的 roundRect)→ 仅显示蓝色
   选中边框,**Inspector 不弹出**(M1.x UX 决策:Inspector 默认隐藏,避免
   遮挡画板)
2. **双击**该节点 → 右上角应浮出 Inspector 浮层,标题 "Format Shape"
3. 改 X 字段 → Tab/Enter → mesh 应跟着移动到新 X
4. 点 Fill Color 色块 → 弹系统颜色选择器 → 选个红色 → mesh 填充色变红
5. 点 Inspector header 上的 `×` → 浮层关闭(选中边框仍显示)
6. 拖动 Inspector header → 浮层位置改变;刷新页面后位置记忆(localStorage)

**预期**:
- 单击节点不打开 Inspector(只显示选中边框)
- 双击节点打开 Inspector
- Inspector 打开期间,切换选中其他节点 → Inspector 跟随切换显示
- 数值字段 Enter / blur 才提交(打字不会高频重渲染)
- 色块改色立即生效
- Inspector 拖动到屏幕外被 clamp 在 viewport 内
- 改完任何属性后 toolbar 标题应短暂显示 `•`(脏)然后消失

**失败迹象**:
- ❌ 单击就弹 Inspector → UX 决策没落地
- ❌ 双击不开 Inspector → onDoubleClick 没接通
- ❌ 改色后 mesh 颜色没变 → NodeRenderer.update 没跑或 mesh 重建失败
- ❌ 改完不保存 → handleInstanceUpdate 没调 scheduleSave

---

### Test 6:拖动节点 + Line 跟随(§2.1 第 14 项核心)

**步骤**:
1. 实例化两个 roundRect(A 在左,B 在右)
2. ⚠️ 当前没有 UI 入口创建 line 实例 — **跳过 line 创建**(M1 范围内 line 创建需要单独 UX,留 v1.1)
3. 改用 dev fixture 验证(`import.meta.env.DEV` 模式下,新画板会显示 7 个 dev 节点,其中 2 条 line 连接 dev-1↔dev-3 和 dev-4↔dev-5)
4. 单击 dev-1 节点(roundRect),拖动它

**预期**:
- 节点跟随鼠标
- 连接 dev-1 的 elbow line 实时跟随,端点保持在 dev-1 的 magnet 位置
- 多选(Shift-click 多个)+ 拖动 → 一起移动

**失败迹象**:
- ❌ 拖动节点 line 不跟随 → updateLinesFor 没在 mousemove 时调用
- ❌ Line 跟随但卡顿 → updateLineGeometry 应该是增量顶点更新,如果重建 mesh 会卡

**已知限制(M1)**:
- ❌ **没有 UI 创建 line**(M1.6+ 或 v1.1 才做),M1 范围只验"已存在 line 跟随 shape 移动"
- M1 验收第 14 项的"创建 line,两端 magnet 自动吸附到附近 shape" — **需要 magnet snapping during line creation,这是 v1.1**。M1 范围验"shape 移动时 line 自动跟随"足够(M1.2c 实现的就是这部分)

---

### Test 7:Delete 删除

**步骤**:
1. 单击一个节点(必须不是 line — line 实例直接选不中,M1 范围)
2. 按 Delete 或 Backspace

**预期**:
- 节点消失
- 引用该节点的 line 也消失(级联删除)
- 选区清空,Inspector 隐藏

**失败迹象**:
- ❌ 按 Del 无反应 → 容器没获得键盘焦点(检查 tabIndex)
- ❌ 节点消失但 line 还在 → NodeRenderer.remove 的 orphans 级联逻辑出错

---

### Test 8:滚轮 + 平移

**步骤**:
1. 在画布上滚轮向上 → 放大
2. 滚轮向下 → 缩小
3. 滚轮在某节点上 → 应以该节点为中心缩放(zoom-to-cursor)
4. 在画布空白处按住鼠标 + 拖动 → 平移

**预期**:
- toolbar 显示 zoom 百分比(基线 100%)
- zoom 在 50/20 倍上下界 clamp(滚到极限不再变)
- 平移流畅,松手不漂移

**失败迹象**:
- ❌ 滚轮触发浏览器历史导航(macOS 双指)→ wheel listener `passive: false` 没生效
- ❌ Zoom 中心不在光标 → handleWheel 内 zoom-to-cursor 数学错

---

### Test 9:重启恢复(§2.1 第 11 项核心)

**步骤**:
1. 创建一个新画板 + 添加 3 个 shape + 1 个 substance + 改其中一个的颜色
2. 等 2 秒(让 1s 防抖 save 完)
3. 关闭整个应用(Cmd+Q)
4. 重新启动 → 切到 Graph workMode
5. NavSide 应仍能看到刚创建的画板
6. 单击它

**预期**:
- 画板内容完整恢复:所有节点位置 / 大小 / 颜色 / params 都对
- 视口 / 缩放 / 平移状态恢复(viewBox 序列化保存)
- toolbar 标题对应

**失败迹象**:
- ❌ 重启后画板不在列表 → graphCreate / graphStore 没真正写盘
- ❌ 画板在但内容空 → graphSave 没在 1s 防抖期写完(关应用太快),或 doc_content 序列化丢
- ❌ 内容部分恢复(比如 line 没跟随)→ user_substances 字段或 deserialize 有 bug

**这是 M1 最关键的验收项**。

---

### Test 10:Combine to Substance(§2.1 第 12 项)

**步骤**:
1. 在画布上添加 3 个 shape(roundRect + diamond + ellipse)
2. Shift-click 它们多选(应都显示蓝色选区)
3. Toolbar 右侧应 inline 出现 `[⊟ Combine to Substance]` 按钮
4. 点击 → 弹模态对话框 "Create Substance"
5. 输入 Name = "测试 Substance",Category 用默认 user
6. 点 Create

**预期**:
- 对话框关闭
- 画布上原 3 个 shape **替换为一个 substance 实例**(放在原 bbox 中心)
- Library Picker 的 Substances → User 分类下应能看到 "测试 Substance"
- 1 秒后自动持久化(`•` 出现再消失)

**已知限制**:
- ⚠️ user substance 通过 `user_substances` 字段嵌入画板 doc_content(M1 范围)
- ⚠️ **跨画板共享 user substance v1 不支持**(其他画板的 LibraryPicker 看不到,需要重启应用 + 重打开同一画板)— 这是 M1 范围 trade-off,M2 之前应升级

---

### Test 11:NavSide 文件夹

**步骤**:
1. NavSide 点 `+ 文件夹` → 创建新文件夹,自动重命名
2. 输入 "Test Folder" + Enter
3. 拖一个画板到文件夹上 → 画板移入
4. 点击文件夹展开图标 → 看到画板
5. 右键文件夹 → "新建画板 / 在此新建文件夹 / 重命名 / 删除"
6. 删除文件夹 → 子画板回到根级(folder_id 置 null)

**预期**:
- 文件夹增删改 + 拖拽全部正常
- 右键菜单完整

---

## 已知 M1 范围限制

下列功能不在 M1,**测试时遇到不算 bug**:
- **选中节点的 8 个 resize handles + 旋转 handle**(对齐 Freeform / Figma)— v1.1
  - M1 选中只显示**蓝色矩形边框**,无法通过拖动 handle 改 size / rotate
- 框选(drag-select)— v1.1
- Cmd+Z 撤销 / Cmd+C/V 复制粘贴 — v1.1(toolbar 已不显示占位按钮)
- 拖动 line 端点 — v1.1
- **创建 line 的 UI**(从 picker 选 line shape 后画板上画 line 的交互)— v1.1
- substance props 编辑(label / gender / birth / death)— v1.1
- Inspector Arrow / dash / 透明度 — v1.1
- 跨画板共享 user substance — M2 之前
- right-slot 调用方式(canvasAPI)— M1.6 完成后

## M1.x UX 决策(已落实到 spec)

- **Toolbar 添加按钮**:`+ Shape` / `◇ Substance` 合并为单一 `+ 添加`(SVG 图标),
  Picker 内 Shape/Substance 类目平铺;不再向用户暴露内部架构区分
- **撤销/重做占位按钮删除**:灰按钮反而困惑用户,真做时再加
- **Inspector 默认隐藏**:单击节点只显示选中边框,**双击才打开 Inspector**
  浮层(避免遮挡画板);Inspector 打开后跟随切换选中节点显示属性

---

## 测试报告(填写区)

| Test | 结果 | 备注 |
|---|---|---|
| 1 NavSide + 画板 | ⬜ | |
| 2 Library Picker | ⬜ | |
| 3 实例化 Shape | ⬜ | |
| 4 实例化 Substance | ⬜ | |
| 5 Inspector 改属性 | ⬜ | |
| 6 拖动 + Line 跟随 | ⬜ | |
| 7 Delete | ⬜ | |
| 8 滚轮 + 平移 | ⬜ | |
| 9 重启恢复 | ⬜ | |
| 10 Combine | ⬜ | |
| 11 NavSide 文件夹 | ⬜ | |

**整体结论**:____________

**阻塞 M1.6 的 bug**(必修):
1.
2.

**可留 v1.x 的小问题**:
1.
2.

# 技术栈 — 定义

> **目的**：定义 KRIG Note 项目的技术选型和选型理由。
> 技术栈一旦确定，所有开发必须在此约束下进行。

---

## 一、总览

| 层 | 技术 | 版本策略 |
|---|---|---|
| **目标平台** | macOS + Windows | 一套代码，跨平台运行 |
| **桌面框架** | Electron | 跟随最新稳定版 |
| **构建** | electron-forge + Vite | 多入口构建 |
| **UI 框架** | React | 跟随最新稳定版 |
| **语言** | TypeScript | strict 模式 |
| **主题/样式** | CSS 变量 + 配置文件 | UI 配置化 |
| **编辑器引擎** | ProseMirror | NoteView 插件内部选择，框架不绑定 |

---

## 二、各技术选型理由

### 2.1 Electron

**职责**：桌面应用骨架、多进程管理、系统 API 集成

**为什么选它**：
- **多 WebContentsView**：每个 View 是独立的 renderer 进程，天然进程隔离，符合 View 懒创建 + 独立生命周期的架构
- **macOS 原生集成**：Application Menu（注册机制）、窗口管理、文件系统、shell.openExternal
- **浏览器环境**：PDFView（pdf.js）、GraphView（WebGL2）、WebView（加载任意 URL）都需要完整的浏览器能力
- **生态成熟**：auto-update、打包分发、DevTools

**不选 Tauri 的原因**：多 webview 独立进程的能力不如 Electron 的 WebContentsView 灵活，跨 webview 通信更麻烦。

### 2.2 React

**职责**：所有层的 UI 渲染（NavSide、WorkspaceBar、View 内部 Toolbar、Overlays）

**为什么选它**：
- **统一性**：所有层使用同一 UI 框架，不引入多框架的认知和维护成本
- **ProseMirror 集成已验证**：NoteView 中 React NodeView 模式在 mirro-desktop 中已验证可行
- **生态最大**：组件库、工具链、社区支持最成熟
- **基础特性足够**：项目只需要基础 hooks（useState、useEffect、useCallback、useRef、useMemo），不依赖 React 18/19 的高级特性

**不选 Preact 的原因**：体积优势（37KB）在 Electron 桌面应用中无感，但 ProseMirror 桥接层（ReactNodeView、createRoot）的兼容性有不确定性。收益小、风险不为零。

**不选 Solid/Svelte 的原因**：生态不如 React，且 ProseMirror 集成没有成熟方案。

### 2.3 TypeScript

**职责**：类型安全、接口契约的编译时保障

**为什么选它**：
- 框架的注册接口（ViewTypeRegistration、WorkModeRegistration、ProtocolRegistration 等）需要类型系统约束
- 插件不满足接口 → 编译不通过，这是最基本的"诊断方法"
- strict 模式确保类型安全

### 2.4 electron-forge + Vite

**职责**：构建、打包、开发服务器

**为什么选它**：
- electron-forge：Electron 官方推荐的脚手架，处理打包、签名、分发
- Vite：快速的 HMR 开发体验，支持多入口构建（每个 View 独立入口）

### 2.5 CSS 变量 + 配置文件

**职责**：主题系统、视觉属性配置化

**为什么选它**：
- 符合 principles.md §八「UI 表现层配置化」——视觉属性不硬编码，统一通过配置定义
- CSS 变量原生支持运行时主题切换（暗色/亮色），不需要 CSS-in-JS 的运行时开销
- 配置文件定义设计 token（颜色、间距、字号、圆角），CSS 变量消费

### 2.6 ProseMirror

**职责**：NoteView 的编辑器引擎

**重要约束**：这是 **NoteView 插件的内部选择**，不是框架级技术栈。框架的 View 接口不绑定任何编辑器引擎。

**为什么选它**：
- 纯 ProseMirror（无 Tiptap 运行时），完全控制 Schema、Plugin、NodeView
- Block + Container 二元模型已在 mirro-desktop 中验证
- 性能和灵活性优于 Tiptap 封装层

---

## 三、框架不绑定的技术

以下技术由 View 插件自行选择，框架不限制：

| 插件 | 可选技术 | 当前选择 |
|------|---------|---------|
| NoteView 编辑器引擎 | ProseMirror / CodeMirror / 其他 | ProseMirror |
| PDFView 渲染引擎 | pdf.js / 其他 | pdf.js |
| GraphView 渲染引擎 | WebGL2 / Three.js / D3.js | WebGL2（自建） |
| WebView | Electron WebContentsView | Electron WebContentsView |

框架只定义 View 接口（create/show/hide/destroy），插件内部用什么技术渲染是插件的事。

---

## 四、项目结构（规划）

```
KRIG-Note/                          ← 项目根目录（蓝图库 + 代码）
├── docs/                           ← 设计文档（当前已有的蓝图）
│   ├── principles.md
│   ├── ui-framework/
│   ├── navside/
│   └── application-menu/
├── src/                            ← 源代码（待创建）
│   ├── framework/                  ← 框架层（Workspace、Slot、View 接口、注册机制）
│   ├── plugins/                    ← 插件层（NoteView、PDFView、WebView、GraphView）
│   └── main/                       ← Electron main 进程
├── package.json
├── tsconfig.json
├── vite.config.ts
└── forge.config.ts
```

> 具体目录结构在开始编码时根据实际需要调整，此处只是规划方向。

---

## 五、约束

1. **框架不绑定 View 内部技术**：View 接口只定义生命周期和通信契约，不限制插件用什么渲染技术
2. **UI 统一 React**：框架层和插件层的 UI 都用 React，不混用多个 UI 框架
3. **配置优先**：视觉属性通过 CSS 变量 + 配置文件定义，不散落在组件代码中
4. **TypeScript strict**：所有代码使用 TypeScript strict 模式，接口契约由类型系统保障
5. **跨平台一套代码**：同一份代码必须在 macOS 和 Windows 上都能正常运行。不允许使用平台特有 API 而不提供对等的跨平台方案。平台差异（快捷键 Cmd/Ctrl、菜单栏位置、窗口 chrome、文件路径分隔符）通过 Electron 内置能力或平台抽象层统一处理，不在业务代码中做 `if (platform === 'darwin')` 判断

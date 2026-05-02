# 迁移任务卡：refactor/contracts（波次 1）

> **状态**：草稿
> **创建**：2026-05-02 by Commander
> **执行 Builder 会话**：（待填）

## 引用
- 总纲：[docs/refactor/00-总纲.md](../../00-总纲.md) v2.3 § 9 启动清单
- 评估依据：[docs/evaluation/2026-05-02-L0-L1-evaluation.md](../../../evaluation/2026-05-02-L0-L1-evaluation.md)、L2/L3/L4/L5 评估
- 三角架构定义：总纲 § 7

## 本次范围

**波次 1：契约定型（不动任何运行代码）**

为后续所有重构子波次建立"宪法层"基础设施：CLAUDE.md 红线段落 + 共享类型骨架 + eslint 拦截规则 + 纯工具白名单。本次工作完成后，任何后续 PR 一旦违反规则会被 eslint 自动拦截。

## 本分支只做

按总纲 § 9 启动清单的五件事，**严格按顺序**：

### J1：CLAUDE.md 追加"重构期硬规则"段落

在 [CLAUDE.md](../../../../CLAUDE.md) 文件末尾追加新章节 `## 重构期硬规则`，必须包含以下禁令清单（一字不漏）：

- L5 插件代码（`src/plugins/**`）禁止 import：`openCompanion` / `ensureCompanion` / `closeRightSlot` / `openRightSlot`
- L5 改变布局只能：`dispatch(IntentEvent)`
- L3 `WorkspaceState` 禁止新增业务字段（`activeXxxId` / `expandedXxx`），新状态走 `pluginStates`
- `src/shared/**` 禁止 import `'electron'`
- 五大交互（ContextMenu / Toolbar / Slash / Handle / FloatingToolbar）必须通过对应 Registry 注册
- ContextMenu / Toolbar / Slash / Handle / FloatingToolbar 五类交互禁止在组件内直接 `<Menu>` / `useState` 写菜单项
- **Atom 永远不携带视图特定字段**（不加 `meta.view` / `meta.canvas` / 任何 view-meta）
- 视图层（`src/plugins/**/views/**`）禁止直接 import 任何不在 `tools/lint/pure-utility-allowlist.ts` 的 npm 包
- `plugins/<X>/` 下禁建 `engine/` / `runtime/` / `lib/` 目录
- 跨插件禁止 import：`plugins/<X>/**` 不能 import `plugins/<Y>/**`

段落末尾追加："违反以上任一条 = PR 拒绝合入。详见 [docs/refactor/00-总纲.md](docs/refactor/00-总纲.md)"

### J2：创建 `src/shared/intents.ts`

创建文件 [src/shared/intents.ts](../../../../src/shared/intents.ts)（新文件），导出 IntentEvent 类型骨架：

```ts
/**
 * Intent 事件契约：L5 视图通过 dispatch(IntentEvent) 上抛意图，
 * 由 L3 IntentDispatcher 决定布局响应。视图禁止直接调 openCompanion 等特权 API。
 */

export type IntentEvent =
  | ContentOpenedIntent
  | AiAssistanceRequestedIntent
  | SplitScreenRequestedIntent
  | LayoutModeChangeRequestedIntent;

export interface ContentOpenedIntent {
  type: 'content:opened';
  payload: { viewId: string; resourceId: string };
}

export interface AiAssistanceRequestedIntent {
  type: 'intent:ai-assistance-requested';
  payload: { context?: unknown };
}

export interface SplitScreenRequestedIntent {
  type: 'intent:split-screen-requested';
  payload: { viewId: string };
}

export interface LayoutModeChangeRequestedIntent {
  type: 'intent:layout-mode-change-requested';
  payload: { mode: string };
}
```

**约束**：仅类型，无运行时代码。文件 `import` 列表必须为空。

### J3：创建 `src/shared/ui-primitives.ts`

创建文件 [src/shared/ui-primitives.ts](../../../../src/shared/ui-primitives.ts)（新文件），导出五大类型契约：

按总纲 § 5.4 数据契约草图实现：
- `ViewDefinition`（含 viewId / install / 五大交互独有项）
- `Capability`（含 id / 五大交互注册项 / keybindings / schema / converters / createInstance / commands）
- `ContextMenuItem` / `ToolbarItem` / `SlashItem` / `HandleItem` / `FloatingToolbarItem`（命令字段必须 `command: string` 不允许 function）
- `KeyBinding`、`CommandHandler`、`SchemaContribution`、`HostElement`、`CapabilityOptions`、`CapabilityInstance`（占位类型即可）
- `enabledWhen` 字段使用 `'always' | 'has-selection' | 'is-editable'` 字面量联合（有限枚举）

**约束**：仅类型，无运行时代码。`import` 列表为空。允许内部交叉引用（如 `ViewDefinition.contextMenu` 引用 `ContextMenuItem`）。

### J4：创建 `tools/lint/pure-utility-allowlist.ts`

创建文件 [tools/lint/pure-utility-allowlist.ts](../../../../tools/lint/pure-utility-allowlist.ts)（新文件 + 新目录 `tools/lint/`），导出纯工具白名单：

```ts
/**
 * 纯函数工具白名单——视图层与插件层允许直接 import 的 npm 包。
 * 准入标准（见总纲 § 1.3 规则 B）：无状态 / 无生命周期 / 无 UI / 调用即返回。
 * 修订需独立 PR + 评审。
 */
export const PURE_UTILITY_ALLOWLIST = [
  // 时间
  'dayjs',
  'date-fns',
  // 函数式工具
  'lodash',
  'lodash-es',
  // class 拼接
  'clsx',
  'classnames',
  // ID 生成
  'nanoid',
  'uuid',
  // 类型校验
  'zod',
  // UI 框架本身（视图组件天然要 import React）
  'react',
  'react-dom',
  // 状态库（无副作用、无生命周期）
  'zustand',
  'jotai',
] as const;

export type PureUtility = typeof PURE_UTILITY_ALLOWLIST[number];
```

**约束**：仅常量 + 类型，无逻辑代码。

### J5：配置 eslint `no-restricted-imports` 规则

在仓库现有 ESLint 配置文件中（`.eslintrc.cjs` / `.eslintrc.js` / `eslint.config.js` 等，由 Builder 探查并选择正确文件）追加规则：

| 规则 | 范围 | 严重度 |
|------|------|--------|
| 禁止 import 布局特权 API（`openCompanion` / `ensureCompanion` / `closeRightSlot` / `openRightSlot`） | `src/plugins/**` | error |
| 禁止跨插件 import（`plugins/<X>` 不能 import `plugins/<Y>`） | `src/plugins/**` | error |
| 禁止 import `electron` | `src/shared/**` | error |
| 禁止 import 任何不在 `PURE_UTILITY_ALLOWLIST` 的 npm 包 | `src/plugins/**/views/**` | **warn**（波次 3 升 error） |
| 禁建 `engine/` / `runtime/` / `lib/` 目录 | `src/plugins/<X>/` | error（用 `no-restricted-paths` 或自定义检查） |

**实施细节**：
- 跨插件禁令可通过 `no-restricted-imports` 的 `patterns` + glob 实现，或者用 `eslint-plugin-import` 的 `no-restricted-paths` 规则
- 白名单的"非白名单 npm 包"判定：可用 `no-restricted-imports` 配合 `patterns` 排除已知白名单
- 目录禁建可作为 GitHub Actions 检查或脚本校验，eslint 不擅长此场景——**Builder 如认为 eslint 无法表达该规则，可降级为 `tools/lint/check-plugin-dirs.sh` 脚本**，并在 README 注明

**新增/修改测试**：在某个示例文件中尝试违规 import（如临时添加 `// @ts-expect-error eslint test` 注释 + 违规 import），确认 eslint 报错预期。验证完成后**移除测试代码**。

## 严禁顺手做

- ❌ 不修改任何业务代码（`src/main/**`、`src/renderer/**`、`src/plugins/**`、`src/capabilities/**` 内既有文件）
- ❌ 不创建任何 `src/capabilities/*` 目录或文件（这是波次 2 的工作）
- ❌ 不创建任何 `plugins/*/views/*` 目录（这是波次 3 的工作）
- ❌ 不修改 `src/shared/types/schema-*.ts`（已存在的四份骨架，本次不动）
- ❌ 不修改任何 commit / merge / push 已有提交（仅在本分支新增 commit）
- ❌ 不优化已有代码、不重命名、不调整格式
- ❌ 不动 memory 文件
- ❌ 即便发现总纲拼写错误也不改（独立 PR 处理）

## 完成判据

每条 Builder 必须证明：

- [ ] **J1**: CLAUDE.md 末尾存在 `## 重构期硬规则` 段落，包含 10 条禁令；段落最后引用总纲路径
- [ ] **J2**: `src/shared/intents.ts` 存在，可被 `import type { IntentEvent } from '@shared/intents'`（或等价路径）；文件无 `import` 语句；无运行时代码
- [ ] **J3**: `src/shared/ui-primitives.ts` 存在，导出至少 `ViewDefinition`、`Capability`、`ContextMenuItem`、`ToolbarItem`、`SlashItem`、`HandleItem`、`FloatingToolbarItem`、`KeyBinding`、`CommandHandler` 类型；文件无 `import` 语句；无运行时代码
- [ ] **J4**: `tools/lint/pure-utility-allowlist.ts` 存在，`PURE_UTILITY_ALLOWLIST` 数组含至少 13 项
- [ ] **J5a**: ESLint 配置已修改；故意写一个违规 import（如 `src/plugins/note/test-violation.ts` 中 import 一个非白名单 npm 包）跑 `npm run lint` 报错；验证后**该测试文件已删除**
- [ ] **J5b**: 现有代码中已存在的违规（已知 web 插件 `import openai`、ebook 插件 `import pdfjs-dist` 等）跑 lint 输出 **warn**，不阻塞 CI
- [ ] **J6**: `git diff main..HEAD` 无任何业务文件改动（除上述 J1~J5 涉及的新文件 + ESLint 配置 + CLAUDE.md）
- [ ] **J7**: 所有新建的 `.ts` 文件都能通过项目 type-check（`npm run typecheck` 或等价命令）

## 已知风险

来自总纲 + memory 的相关注意点：

- **R1**: 仓库可能用 ESLint flat config（`eslint.config.js`）也可能用 legacy（`.eslintrc.cjs`）——Builder 第一步要探查 [package.json](../../../../package.json) 和仓库根目录确定，按现有结构修改，不擅自切换 config 风格
- **R2**: TypeScript 路径别名（`@shared/`、`@capabilities/` 等）是否已配置在 tsconfig.json 的 `paths` 字段——Builder 要确认现有 path 配置，新文件采用与现有 `src/shared/types/schema-*.ts` 一致的 import 写法
- **R3**: `tools/lint/` 目录是新建——必须保证它在 tsconfig 的 `include` 范围内，否则类型检查会跳过该文件
- **R4**: Builder **不读 memory**，但要知道存在 memory `feedback_merge_requires_explicit_ok`——本任务卡也遵守：commit 由 Builder 自己做，merge/push 不做（列命令给 Commander）

## 待 Builder 反问的预期问题

> Commander 起草时已知存在歧义、留待 Builder 启动时确认

1. **R1**：仓库当前 ESLint config 是 flat 还是 legacy？Builder 启动后探查并报告，由 Commander 决定是否调整 J5 实施方式
2. **目录禁建（J5 第 5 条）**：如果 eslint 表达不了"目录是否存在"这种文件系统层面的检查，Builder 是否可以降级为脚本（`tools/lint/check-plugin-dirs.sh`）？—— **Commander 答**：可以。已在 J5 实施细节中明示
3. **J5 测试**：Builder 添加临时违规文件验证 eslint 是否生效后，是否需要保留作为示例？—— **Commander 答**：不保留，验证完即删，避免污染仓库
4. **CLAUDE.md 现有内容**：CLAUDE.md 已有"分支策略"和"提交规范"——新增"重构期硬规则"作为追加章节，不修改既有内容，对吗？—— **Commander 答**：对。仅在文件末尾追加新章节

## Builder 完成后

- 写报告到 `tmp/builder-report.md`（按 BUILDER-PROMPT § 五格式）
- 在聊天中告知 Commander："builder-report 就绪"
- **不做** merge / push（列命令给 Commander，由用户拍板执行）

## 备注：本次为基础设施类子波次

本次任务**不动业务代码**，因此 BUILDER-PROMPT § 二要求的"功能契约"为 **N/A**。Builder 启动确认中的"契约 § B 防御代码 grep 验证"也跳过（无契约可对照）。

后续 L5 插件迁移子波次（波次 3.x）的 refactor-card 必须引用对应 `migration-contracts/<plugin>.md`，本豁免不适用。

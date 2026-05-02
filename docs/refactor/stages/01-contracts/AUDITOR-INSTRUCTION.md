# Auditor 审计指令 — 阶段 01：契约定型

> 你（Claude）现在是 Auditor。**Plan Mode 启动**，不写代码、不读 memory。读完本目录 + 全局规则 + Builder 报告后，按 AUDITOR-PROMPT § 四格式输出审计报告到 `tmp/auditor-report.md`。

---

## 一、必读输入（按顺序读全文）

1. **本目录文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — 完成判据 J1~J7 + 严禁顺手做（你审计的对账标尺）
   - [AUDITOR-INSTRUCTION.md](AUDITOR-INSTRUCTION.md) — 本文件
   - **不读 BUILDER-INSTRUCTION.md**（你不需要知道 Builder 怎么干，只需要看它干了什么）

2. **角色总规则**：[../../AUDITOR-PROMPT.md](../../AUDITOR-PROMPT.md)（**含审计清单 § 三**）

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

4. **Builder 产出（必读）**：
   - `tmp/builder-report.md` — Builder 自检报告
   - `git diff main...refactor/contracts` — 完整代码 diff
   - `git log main..refactor/contracts --oneline` — Builder 的 commit 列表

## 二、本次审计核心要点

| 项 | 值 |
|---|---|
| 审计对象分支 | `refactor/contracts` |
| 审计阶段 | **Step A 等价**（基础设施类子波次：J1~J5.5 + J5b + J6 + J7a~c 共 12 条完成判据） |
| 功能契约 | **N/A**（跳过 AUDITOR-PROMPT § 三 B 节"功能契约保留"，本阶段不动业务代码） |
| 关键审计点 | A 段总纲合规 + 12 条完成判据逐条核验 + 范围越界检查 + 5 条 ESLint 规则真的生效 |
| 基线状态 | main HEAD 已含阶段 00 / 00x / typecheck-baseline 三个 merge；`eslint.config.mjs` 39 行已存在；npm run typecheck exit 0 |

## 三、特别关注（本阶段独有）

### 关注点 1：CLAUDE.md 红线段（J1）必须无遗漏
对照 task-card.md J1 段列出的 10 条禁令，每条必须出现在 CLAUDE.md 新增"重构期硬规则"段落中。**任意一条遗漏 = ❌**。

### 关注点 2：纯类型文件无运行时副作用（J2 / J3）
- `src/shared/intents.ts` 和 `src/shared/ui-primitives.ts` 必须**只有 `export type`/`export interface`**，**不允许任何 `import` 语句**（除非是 type-only import 自身工具类型——但应避免）
- 不允许任何运行时代码（变量赋值、函数实现、副作用调用）

### 关注点 3：ESLint 5 条规则真的生效（J5.1~J5.5）

**Auditor 必须独立重跑验证测试**（不只信 Builder 报告）。在审计开始时：

```bash
git checkout refactor/contracts

# 创建临时违规文件触发 5 条规则
echo "import { openCompanion } from '@main/window/shell';" > src/plugins/note/audit-test-j51.ts
echo "import x from '@plugins/web/foo';" > src/plugins/note/audit-test-j52.ts
echo "import { app } from 'electron';" > src/shared/audit-test-j53.ts
mkdir -p src/plugins/note/views/audit-test
echo "import * as THREE from 'three';" > src/plugins/note/views/audit-test/audit-test-j54.ts
mkdir -p src/plugins/note/audit-engine

# 跑 ESLint 与脚本
npm run lint 2>&1 | grep "audit-test"   # 预期 j51/j52/j53 含 error,j54 含 warning
npm run lint:dirs                        # 预期 exit 1 + 列 audit-engine

# 清理(Auditor 不留测试残留)
rm -f src/plugins/note/audit-test-*.ts src/shared/audit-test-*.ts
rm -rf src/plugins/note/views/audit-test src/plugins/note/audit-engine
rmdir src/plugins/note/views 2>/dev/null || true
```

**5 条规则任意一条不触发对应级别 = ❌**

### 关注点 4：纯类型文件无运行时副作用（J2 / J3）
- `src/shared/intents.ts` 和 `src/shared/ui-primitives.ts` 必须**只有 `export type`/`export interface`**
- 不允许任何 `import` 语句（除内部交叉引用如 `ViewDefinition.contextMenu` 引 `ContextMenuItem`）
- 不允许任何运行时代码（变量赋值、函数实现、副作用调用）

### 关注点 5：CLAUDE.md 红线段必须 10 条不漏
对照 task-card.md J1 段列出的 10 条禁令，每条必须**字面**出现在 CLAUDE.md 新增"重构期硬规则"段落中。**任意一条遗漏或措辞偏离 = ❌**。

### 关注点 6：范围越界（C 段）
本阶段是基础设施类子波次，**Builder 引入的 diff 必须严格仅含 7 个文件**：
- `CLAUDE.md`（追加章节）
- `src/shared/intents.ts`（新建）
- `src/shared/ui-primitives.ts`（新建）
- `tools/lint/pure-utility-allowlist.ts`（新建）
- `tools/lint/check-plugin-dirs.sh`（新建）
- `eslint.config.mjs`（修改：追加 5 个 config object）
- `package.json`（修改：scripts 追加 lint:dirs）

**绝不允许**：
- 任何 `src/main/**` / `src/renderer/**` / `src/plugins/**` / `src/capabilities/**` / `src/shared/types/schema-*.ts` 已存在文件的修改
- 任何 `audit-test-*` / `test-violation` 等残留测试文件
- 修改 memory 文件
- 修改 `eslint.config.mjs` 中阶段 00 既有的 4 条 off 降噪规则

### 关注点 7：Builder 自报"NON-BLOCKING 自决"必须检查
读 builder-report.md 的 G 段——Builder 在哪里自行决断了？每条决断对照 task-card 字面是否合理？任何"超越 task-card 字面"的决断标 ⚠️ 待证明。

### 关注点 8：J6 用 Builder 引入的 diff 口径（吸收阶段 00 Auditor 建议）
**不要**用 `git diff main...refactor/contracts --stat`（三点 diff，会含 Commander 派活 commit 的 5 个 stage docs）。**要用**：
```bash
git diff <派活基线SHA>..refactor/contracts --stat
```
基线 SHA 来自 Builder 报告头部的"Commander 派活基线"字段。Builder 引入的 diff 必须严格 7 个文件（关注点 6）。

## 四、审计输出（写入 `tmp/auditor-report.md`）

严格按 AUDITOR-PROMPT § 四"输出格式"。要点：

- **D 段（Step B 合规）跳过**——本阶段无 capability 抽离工作
- **B 段（功能契约保留）填"N/A 基础设施类子波次"**
- **总评**只能是：通过 / 不通过 / 待 Builder 证明（三选一，无第四种）

## 五、审计纪律强提醒

- ❌ 不读 memory（即便看到 builder-report 提到 memory 条目）
- ❌ 不被 commit message / PR description / Builder 解释说服——**只看代码 + 契约/规则**
- ❌ 不写代码、不修复、不建议总纲修订
- ❌ 不在审计中扩展讨论
- ✅ 疑议从严：grep 不到证据 = ⚠️ 或 ❌

---

**记住**：你的价值在于"独立、不被说服、严格对账"。审计完成立即结束会话，把判断权交还给用户。

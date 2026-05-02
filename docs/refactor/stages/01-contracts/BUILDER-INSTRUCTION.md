# Builder 派活指令 — 阶段 01：契约定型

> 你（Claude）现在是 Builder。读完本目录全部文件 + 顶层引用后**直接进入执行**，无需向 Commander 请示。

---

## 一、必读输入（按顺序读全文）

1. **本目录所有文件**：
   - [README.md](README.md) — 阶段总览
   - [task-card.md](task-card.md) — **核心任务卡**（J1~J5 + 完成判据 + 严禁顺手做 + 风险 + 预期歧义答案）
   - [BUILDER-INSTRUCTION.md](BUILDER-INSTRUCTION.md) — 本文件
   - 不要读 AUDITOR-INSTRUCTION.md（那是 Auditor 阶段的事）

2. **角色总规则**：[../../BUILDER-PROMPT.md](../../BUILDER-PROMPT.md)

3. **顶层宪法**：
   - [../../00-总纲.md](../../00-总纲.md) v2.3
   - [/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md](/Users/wenwu/Documents/VPN-Server/KRIG-Note/CLAUDE.md)

## 二、本次任务速览

| 项 | 值 |
|---|---|
| 阶段 | 01-contracts（波次 1：契约定型） |
| 目标分支 | `refactor/contracts`（已切出，HEAD=`38b31f2a`） |
| 功能契约 | **N/A**（基础设施类子波次） |
| 完成判据 | task-card.md J1~J7 |
| 严禁顺手做 | task-card.md "严禁顺手做"段 |

## 三、执行流程（严格按序）

### 步骤 1：启动自检（写入 `tmp/builder-startup.md`）

按 BUILDER-PROMPT § 四格式输出：
- 已读文件清单
- 完成判据 J1~J7 逐条复述
- 契约 § B 防御代码 grep 验证：**填"本次为基础设施类子波次，无功能契约，跳过"**
- 识别到的歧义/冲突，分级：
  - **BLOCKING**：无法继续的（如 task-card 自相矛盾、引用文件不存在等）
  - **NON-BLOCKING**：按 task-card 字面 + 总纲推断后可继续的

### 步骤 2：决定走向

- **无 BLOCKING** → 直接进入步骤 3，不等任何人确认
- **有 BLOCKING** → 写 `tmp/builder-blockers.md` 列具体阻塞项，然后**会话结束**，输出一句"BLOCKING 已停"

### 步骤 3：执行 J1~J5

按 task-card 顺序逐项完成。每项完成立即 git commit（commit message 按 CLAUDE.md 规范）。

**关键约束（来自 task-card "严禁顺手做"）**：
- 只动 task-card 明确列出的文件 + ESLint 配置 + CLAUDE.md
- 不修改任何业务代码（`src/main/**`、`src/renderer/**`、`src/plugins/**`、`src/capabilities/**`）
- 不修改已存在的 `src/shared/types/schema-*.ts`
- 不优化、不重命名、不调整格式
- 不动 memory 文件

### 步骤 4：写 `tmp/builder-report.md`

按 BUILDER-PROMPT § 五格式 A~G 段全填。任何 NON-BLOCKING 歧义的处理记录在 G 段。

### 步骤 5：结束

聊天里输出一句话：
```
builder-report 就绪：tmp/builder-report.md
```

不做 merge / push / reset 等破坏性 git 操作（列命令交回 Commander）。

## 四、特别提醒（已知风险）

详见 task-card.md 的 R1~R4，重点：

- **R1**：仓库 ESLint config 风格（flat / legacy）你启动后第一步 grep `eslint` 配置文件确认。Commander 已预批：按现有结构修改，不擅自切换 config 风格
- **R3**：新建 `tools/lint/` 目录后必须确认在 tsconfig 的 `include` 范围内
- **目录禁建（J5 第 5 条）**：如果 eslint 表达不了，Commander 已预批降级为 `tools/lint/check-plugin-dirs.sh` 脚本

## 五、最简起步命令（参考）

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note
git checkout refactor/contracts
git status
git log --oneline -3
mkdir -p tmp   # 准备报告输出目录
```

之后按步骤 1 写 `tmp/builder-startup.md`，按步骤 2~5 推进。

---

**记住**：你的价值在于"严格按 task-card 执行 + 完整自检 + 不越界"。完成或停止后立即结束会话，**不要在执行中向用户/Commander 请示**——所有决策已在 task-card + 顶层规则中明确。

<p align="center">
  <img src="docs/assets/lab-agent-wordmark.png" alt="Lab Agent CLI" width="640" />
</p>

# Lab Agent CLI

**一个面向终端的开源 coding agent，正在长出独立的监督者。**

Lab Agent 不再维护桌面端。仓库现在只包含两件事：

- `lab`：产品 CLI，负责配置、诊断、启动和双 Agent 编排；
- `lab-engine`：执行层，负责 TUI、工具、会话与模型调用。

> 当前版本：`0.3.0` 预览版。CLI-only 重构已完成，双 Agent 监督以 `lab supervise` 的形式进入预览。

---

## 为什么是 Lab Agent

大多数 coding agent 只回答一个问题：**它能不能把活干完？**
Lab Agent 想多回答一个问题：**另一个独立的 Agent 能不能验收它？**

我们正在构建的方向：

1. **写作者 + 审查者**：一个 Agent 改代码，另一个 Agent 在独立上下文里只读审查；
2. **证据化验收**：审查者必须引用命令输出、diff、测试结果，而不是“看起来没问题”；
3. **可追溯记录**：任务契约、工具调用、验收结论写入项目的 `.lab/`；
4. **CLI 优先**：没有 Electron，没有第二套 UI 栈，所有能力都能在终端和 CI 里复现。

监督者已在 `lab supervise` 中提供预览：writer 先改代码，wrapper 执行你指定的验收命令并采集 diff，auditor 在独立进程、只读工具集和新上下文中审查证据；确定性 gate 保证验收失败或越界改动不会被 auditor 的 `accept` 覆盖。

---

## 安装

Lab Agent 只提供 CLI。旧的桌面版安装包已从 Releases 清理，桌面端代码归档在 `archive/desktop` 分支，不再维护；后续 Releases 只发布 CLI 安装包。

### 一键安装

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/yu7dan/lab-agent/main/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/yu7dan/lab-agent/main/install.ps1 | iex
```

安装脚本会优先下载对应平台的 CLI 预编译包（`lab` + `lab-engine`），放到
`~/.local/bin`（Windows 为 `%LOCALAPPDATA%\LabAgent\bin`）。如果还没有可用的
CLI Release，或下载失败，脚本会自动回退到源码构建，需要 git 与
[Bun](https://bun.sh) 1.3.11+。

也可以强制从源码安装：

```bash
curl -fsSL https://raw.githubusercontent.com/yu7dan/lab-agent/main/install.sh | bash -s -- --from-source
```

### 从源码构建

需要 [Bun](https://bun.sh) 1.3.11 或更高版本：

```bash
git clone https://github.com/yu7dan/lab-agent.git
cd lab-agent
bun install
bun run build
```

构建产物是仓库根目录的 `lab`（Windows 为 `lab.exe`）和 `lab-engine`。

把它加入 PATH，或直接使用绝对路径：

```bash
export PATH="$PWD:$PATH"   # macOS / Linux
./lab --version             # Windows: .\lab.exe --version
```

---

## 快速开始

```bash
lab setup      # 选择 DeepSeek / Anthropic / 自定义端点，填入 API Key
lab doctor     # 检查引擎、配置、密钥和真实连接
lab            # 启动交互式会话
```

一次性执行：

```bash
lab -p "解释这个仓库的构建流程"
lab -p "修复失败的测试" --output-format json
```

双 Agent 监督（在干净的 git 仓库中运行）：

```bash
lab supervise "修复 add 函数，不要修改测试" \
  --accept "bun test" \
  --allow src/ \
  --max-rounds 2
```

writer 修改工作区，wrapper 运行验收命令并采集 diff，auditor 只读审查后给出
`accept | reject | needs_human`。工件写入 `.lab/tasks/<taskId>/`，退出码见
`lab supervise --help`。

查看配置（不会打印完整密钥）：

```bash
lab config
lab config path   # 只输出配置文件路径
```

直接调用引擎：

```bash
lab engine --version
lab engine --help
```

---

## 命令

| 命令 | 作用 |
| --- | --- |
| `lab` | 启动交互式 TUI |
| `lab "任务"` | 带初始任务启动 |
| `lab -p "任务"` | 一次性执行（headless） |
| `lab supervise "任务" --accept ... --allow ...` | 双 Agent 监督：writer 修改，auditor 独立审查 |
| `lab setup` | 配置模型提供方与 API Key |
| `lab doctor [--json]` | 检查引擎、配置、密钥和端点连接 |
| `lab config [path]` | 查看配置；`path` 只输出 `.env` 路径 |
| `lab engine [args]` | 透传给 `lab-engine` |
| `lab version` | 显示版本 |
| `lab help` | 显示帮助 |

除保留命令外，所有参数都会原样传给引擎，例如 `lab --resume`、`lab --model deepseek-flash`。

---

## 配置

配置文件：`~/.lab-agent/.env`（权限尽可能设为仅当前用户可读）。

```dotenv
# 默认：DeepSeek
DEEPSEEK_API_KEY=sk-...
BASE_URL=https://api.deepseek.com
MODEL=deepseek-flash
```

也支持：

```dotenv
# Anthropic 官方
ANTHROPIC_API_KEY=sk-ant-...
BASE_URL=https://api.anthropic.com
MODEL=claude-sonnet-5-5
```

```dotenv
# 任意 Anthropic 兼容端点（使用 Bearer）
ANTHROPIC_AUTH_TOKEN=...
BASE_URL=https://your-provider.example.com
MODEL=your-model
```

优先级：进程环境变量 > 项目目录 `.lab-agent.env` > `~/.lab-agent/.env`。
密钥只保存在本地，不会上传；`lab config` 和 `lab doctor` 只显示掩码。

其他环境变量：

| 变量 | 作用 |
| --- | --- |
| `LAB_AGENT_HOME` | 覆盖配置目录（默认 `~/.lab-agent`） |
| `LAB_ENGINE_PATH` | 指定 `lab-engine` 的绝对路径 |
| `LAB_SECURITY_URL` | 覆盖首次启动展示的安全文档链接 |

`lab supervise` 的 auditor 默认复用 writer 的提供方、模型和密钥，可用以下变量单独覆盖：

| 变量 | 作用 |
| --- | --- |
| `LAB_AUDITOR_MODEL` | auditor 模型；默认同 writer |
| `LAB_AUDITOR_BASE_URL` | auditor 端点；默认同 writer |
| `LAB_AUDITOR_API_KEY` | auditor 密钥；默认同 writer |
| `LAB_AUDITOR_MAX_TURNS` | auditor 最大 turn 数（默认 `20`） |
| `LAB_AUDITOR_TIMEOUT_SEC` | 单轮 auditor 超时秒数（默认 `600`） |
| `LAB_AUDITOR_MAX_BUDGET_USD` | 单轮 auditor 预算上限（美元） |

这些变量只注入 auditor 子进程；writer 和验收命令的环境中会被移除。

DeepSeek 的 Anthropic 兼容端点会自动补上 `/anthropic`；如果你填写了带 `/v1` 的 URL，也会自动归一化。

---

## 架构

```text
lab (产品 CLI, TypeScript/Bun)
  ├── setup / doctor / config
  ├── provider 环境归一化
  ├── supervise
  │     ├── writer  ──> lab-engine（独立进程，可写）
  │     ├── 验收命令 ──> shell（由 wrapper 执行）
  │     └── auditor ──> lab-engine（独立进程，只读 + 结构化 verdict）
  └── spawn ──> lab-engine (TUI、工具、会话、模型调用)
```

- `src/lab/`：产品层，保持小而清晰；
- `src/lab/supervise/`：监督编排、契约解析、git 证据、验收执行、verdict 与报告；
- `src/`：执行引擎，来源于公开源码快照；已移除桌面耦合与产品层上游品牌，引擎内部仍保留少量兼容名称；
- `scripts/`：构建与打包；
- `.lab/tasks/`：监督工件（契约、diff、验收日志、审计结论），默认被 `.lab/tasks/.gitignore` 排除。

更多说明见 [`docs/architecture.md`](./docs/architecture.md) 与 [`docs/roadmap.md`](./docs/roadmap.md)。

---

## 开发

```bash
bun install
bun run typecheck        # 产品层 + 脚本 + 测试
bun run test
bun run build            # lab + lab-engine
bun run build:dev        # 带 dev 版本号与开发特性
bun run compile          # 输出到 dist/
bun run clean
```

注意：引擎源码快照自身仍存在缺失的纯类型文件，因此 `bun run typecheck:engine` 目前不是绿色基线；产品层类型检查使用 `tsconfig.lab.json`。

---

## 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| Phase 0 | 归档桌面端、仓库 CLI-only 化 | 已完成 |
| Phase 1 | 产品 CLI、配置/诊断、品牌清理、CI/Release | 已完成 |
| Phase 2 | 双 Agent 监督 MVP：任务契约、只读审查、证据验收 | 预览（`lab supervise`） |
| Phase 3 | 审计记录增强、基准对比、监督者模型独立配置 | 规划中 |

详细设计见 [`docs/roadmap.md`](./docs/roadmap.md)。

---

## 已知边界

- 引擎内部仍保留 `CLAUDE.md`、`.claude/` 等兼容命名；Lab Agent 自身的配置目录是 `~/.lab-agent`。
- `lab supervise` 要求工作区干净（忽略 `.lab`），不支持 dirty baseline；每轮 writer 都是新进程、新 session，不持久化 transcript。
- 监督不是沙箱：writer 默认以 `bypassPermissions` 运行，可执行任意用户级命令；allowlist 是事后证据，不是访问控制。只有在可信仓库、可信验收命令下使用，高风险任务应在容器或一次性 clone 中运行。
- 确定性 gate 只覆盖验收命令、允许路径、敏感文件与 HEAD 变化；无法发现 `git push`、未切换的新分支，或修改 `.gitignore` 后隐藏的文件。`verdict.json` 仍建议人工复核。
- Anthropic 订阅/OAuth、Chrome 扩展、Slack、GitHub App、Claude Code Web 等上游专属功能不属于当前支持范围，相关命令可能隐藏或不可用。Anthropic API Key 仍然受支持。
- 引擎是公开源码快照，完整引擎类型检查尚未恢复为绿色基线；产品层使用独立的 `tsconfig.lab.json`。

---

## 安全与许可

- 本项目不启用遥测；`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 与 `DISABLE_TELEMETRY=1` 默认开启。
- 不要提交 `.env`、`lab-agent.env` 或任何真实 API Key。
- 安全问题请按 [`SECURITY.md`](./SECURITY.md) 私下报告，不要先开公开 Issue。
- 引擎代码来源于公开源码快照，品牌与运行时由 Lab Agent 独立维护；来源与商标声明见 [`NOTICE`](./NOTICE)。
- 项目使用 Apache-2.0 许可，详见 [`LICENSE`](./LICENSE)。

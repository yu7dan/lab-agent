# Lab Agent CLI

**一个面向终端的开源 coding agent，正在长出独立的监督者。**

Lab Agent 不再维护桌面端。仓库现在只包含两件事：

- `lab`：产品 CLI，负责配置、诊断、启动和未来的双 Agent 编排；
- `lab-engine`：执行层，负责 TUI、工具、会话与模型调用。

> 当前版本：`0.3.0` 预览版。CLI-only 重构已完成，双 Agent 监督是下一阶段的主线。

---

## 为什么是 Lab Agent

大多数 coding agent 只回答一个问题：**它能不能把活干完？**
Lab Agent 想多回答一个问题：**另一个独立的 Agent 能不能验收它？**

我们正在构建的方向：

1. **写作者 + 审查者**：一个 Agent 改代码，另一个 Agent 在独立上下文里只读审查；
2. **证据化验收**：审查者必须引用命令输出、diff、测试结果，而不是“看起来没问题”；
3. **可追溯记录**：任务契约、工具调用、验收结论写入项目的 `.lab/`；
4. **CLI 优先**：没有 Electron，没有第二套 UI 栈，所有能力都能在终端和 CI 里复现。

监督者尚未在 `0.3.0` 中实现。当前版本先把产品边界、配置链路和发布流程做干净。

---

## 安装

### 预编译包（Release 发布后）

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/yu7dan/lab-agent/main/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/yu7dan/lab-agent/main/install.ps1 | iex
```

安装脚本会下载对应平台的 `lab` 与 `lab-engine`，并放到 `~/.local/bin`（Windows 为 `%LOCALAPPDATA%\LabAgent\bin`）。

### 从源码构建（当前推荐）

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

DeepSeek 的 Anthropic 兼容端点会自动补上 `/anthropic`；如果你填写了带 `/v1` 的 URL，也会自动归一化。

---

## 架构

```text
lab (产品 CLI, TypeScript/Bun)
  ├── setup / doctor / config
  ├── provider 环境归一化
  └── spawn ──> lab-engine (TUI、工具、会话、模型调用)
```

- `src/lab/`：新产品层，保持小而清晰，未来在这里实现监督者编排；
- `src/`：执行引擎，来源于公开源码快照，已移除 Claude/上游品牌与桌面耦合；
- `scripts/`：构建与打包；
- `.lab/`：未来存放任务契约与审查记录（当前尚未启用）。

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
| Phase 2 | 双 Agent 监督 MVP：任务契约、只读审查、证据验收 | 规划中 |
| Phase 3 | `.lab/` 审计记录、基准对比、监督者模型独立配置 | 规划中 |

详细设计见 [`docs/roadmap.md`](./docs/roadmap.md)。

---

## 安全与许可

- 本项目不启用遥测；`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` 与 `DISABLE_TELEMETRY=1` 默认开启。
- 不要提交 `.env`、`lab-agent.env` 或任何真实 API Key。
- 安全问题请按 [`SECURITY.md`](./SECURITY.md) 私下报告，不要先开公开 Issue。
- 引擎代码来源于公开源码快照，品牌与运行时由 Lab Agent 独立维护；来源与商标声明见 [`NOTICE`](./NOTICE)。
- 项目使用 Apache-2.0 许可，详见 [`LICENSE`](./LICENSE)。

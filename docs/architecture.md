# Architecture

## Product boundary

```text
┌───────────────────────────────────────────────────────────┐
│ lab  (src/lab, compiled by build-cli.ts)                  │
│                                                           │
│  setup   doctor   config   engine passthrough             │
│  provider env normalization                               │
│  supervise: contract · git evidence · acceptance · gate   │
└───────────────┬───────────────────────────┬───────────────┘
                │ spawn, inherited stdio   │ spawn, captured JSON
                ▼                           ▼
┌──────────────────────────────┐  ┌─────────────────────────┐
│ lab-engine (src)             │  │ lab-engine (writer /    │
│ Ink TUI · tools · sessions   │  │ auditor, headless)      │
│ permissions · hooks · MCP    │  └─────────────────────────┘
└──────────────────────────────┘
```

The wrapper exists so the product can evolve without forking the 1,900-file
engine. Configuration, diagnostics, release branding, and multi-agent
orchestration live in `src/lab/`. The engine handles one agent session at a time.

## Launch sequence

1. `src/lab/cli.ts` parses reserved commands (`setup`, `doctor`, `config`,
   `supervise`, `engine`, `version`, `help`).
2. For a normal run it calls `applyLabEnvironment(env, projectDir)`:
   - creates `~/.lab-agent` if needed;
   - loads the project `.lab-agent.env`, then `~/.lab-agent/.env`, without
     overriding shell variables (so project values win over the profile);
   - sets `LAB_AGENT_HOME` / `CLAUDE_CONFIG_DIR`;
   - disables non-essential traffic and telemetry by default;
   - normalizes provider variables.
3. If no API key is available and stdin is a TTY, it offers to run `lab setup`.
4. `findEngineBinary()` locates `lab-engine` (`LAB_ENGINE_PATH`, next to the
   launcher, cwd, then repo root) and spawns it with inherited stdio.
5. The engine's exit code becomes the wrapper's exit code.

## Supervision layer

`lab supervise` orchestrates two independent engine processes from
`src/lab/supervise/`:

```text
parse args + optional contract file
  -> resolve repo root (git rev-parse --show-toplevel)
  -> require clean worktree (ignoring .lab) and an existing HEAD
  -> record baseline HEAD + tree
  -> for each round (1 + maxRounds):
       writer engine (headless, new session, no persistence)
       -> temp-index snapshot of the worktree (includes untracked files)
       -> changed paths, diff, allowlist / sensitive-path / HEAD checks
       -> wrapper runs acceptance commands (never the auditor)
       -> evidence bundle (redacted)
       -> auditor engine (read-only tools, new session, JSON schema verdict)
       -> deterministic gate + normalized decision
       -> write round artifacts
       -> accept | need human | bounded rework | reject
  -> write report.json, print human or JSON report
```

Key properties:

- **Separate contexts.** The auditor does not receive the writer's transcript,
  final message, or hidden reasoning — only the frozen contract, diff, path
  findings, acceptance output, and warnings.
- **Read-only auditor.** It runs with `--tools Read,Grep,Glob`,
  `--permission-mode dontAsk`, `--strict-mcp-config`, no setting sources, and
  explicit deny rules. It has no shell, so all acceptance commands are executed
  by the wrapper and cited as evidence.
- **Deterministic gate.** Failed acceptance, path violations, sensitive-file
  changes, or a HEAD change force `reject` even if the auditor says `accept`.
  The wrapper can downgrade an accept, never upgrade a reject.
- **Bounded rework.** `--max-rounds` controls rework rounds (default 2). Each
  round is a fresh writer session; the next prompt includes prior blocking
  findings and deterministic failures.
- **Evidence on disk.** `.lab/tasks/<taskId>/` contains the frozen contract,
  prompts, raw engine JSON, diff, status, acceptance logs, verdicts, and the
  final report. Secrets are redacted before anything is written; transcripts
  are not persisted.

See [roadmap.md](./roadmap.md) for status and [SECURITY.md](../SECURITY.md) for
the threat model.

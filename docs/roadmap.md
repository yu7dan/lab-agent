# Roadmap

## Phase 0 — Archive and simplify (done)

- Tag and branch the last desktop release (`desktop-v0.2.1`, `archive/desktop`).
- Remove the Electron shell, renderer, desktop command, and the separate toy
  agent loops from `main`.
- Move the engine from `agents/lab-coding/` to the repository root.
- Rewrite the repository as “Lab Agent CLI”.

## Phase 1 — A clean CLI product (done in 0.3.0)

- `lab` wrapper with `setup`, `doctor`, `config`, `engine`, `version`, `help`.
- Provider normalization for DeepSeek, Anthropic, and custom
  Anthropic-compatible endpoints.
- `~/.lab-agent` profile with legacy desktop path fallback.
- Brand cleanup in prompts, TUI identity, help text, and error messages.
- Engine + wrapper build pipeline and Windows-aware output handling.
- Unit tests for config, provider normalization, and engine discovery.
- CI and a multi-platform release workflow.

Exit criteria:

- `bun run typecheck` passes for the product layer.
- `bun run test` passes.
- `bun run build` produces `lab` and `lab-engine` on Windows, macOS, and Linux.
- `lab -p "..."` completes against a real provider.

## Phase 2 — Dual-agent supervision MVP

Goal: a second, independent agent can reject the writer's work with evidence.

Planned scope:

- Task contract format (goal, constraints, allowed paths, acceptance commands).
- Writer run via headless engine with a fixed working directory.
- Read-only auditor run with:
  - its own context and model configuration;
  - no write tools;
  - the contract, final diff, and tool evidence as input.
- Structured verdict schema: `accept`, `reject`, `needs_human`, with findings
  that cite file/line or command output.
- Wrapper command: `lab supervise "<task>"`.
- Re-run loop with a bounded number of revision rounds.

Non-goals for Phase 2:

- A GUI.
- Autonomous merging or pushing.
- Multi-writer swarms.
- A hosted service.

## Phase 3 — Audit trail and benchmarks

- `.lab/tasks/<id>/` records: contract, events, diff, reviewer verdicts.
- Deterministic replay of a task's evidence for humans.
- Comparative benchmarks: writer-only vs. writer+auditor on a fixed task set.
- Per-role model/provider configuration (for example, a cheaper writer and a
  stronger auditor).
- Optional redaction and sharing of audit records.

## Explicitly out of scope

- Rebuilding the desktop app.
- Claude/Anthropic branding, OAuth upsells, or upstream marketplaces.
- Telemetry that leaves the machine.

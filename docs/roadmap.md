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

## Phase 2 — Dual-agent supervision MVP (preview in 0.3.0)

Goal: a second, independent agent can reject the writer's work with evidence.

Delivered:

- JSON contract file plus CLI flags: goal, constraints, allowed paths,
  acceptance commands, max rounds, writer mode, timeouts, turn and budget caps.
- Writer run via a new headless engine process with a fixed repo root, its own
  session, and no transcript persistence.
- Deterministic evidence collection: temp-index worktree snapshot (includes
  untracked files), changed paths, diff, path/allowlist checks, sensitive-file
  detection, HEAD-change detection, and wrapper-executed acceptance commands.
- Read-only auditor run in a separate process:
  - `Read` / `Grep` / `Glob` only, `dontAsk`, no MCP, no setting sources;
  - its own model/key/endpoint overrides via `LAB_AUDITOR_*`;
  - the frozen contract, diff, path findings, and acceptance output as input —
    never the writer's transcript or hidden reasoning.
- Structured verdict schema: `accept`, `reject`, `needs_human`, with findings
  that cite file/line or command output; malformed verdicts are infrastructure
  errors and never treated as accept.
- Deterministic gate that forces `reject` on acceptance failure, path
  violation, sensitive-file change, or HEAD change.
- Bounded rework: each round is a fresh writer session; prior blocking findings
  are fed into the next prompt.
- Command: `lab supervise "<task>"` (or `--contract <file>`).
- Artifacts under `.lab/tasks/<taskId>/` with redaction and no persisted
  transcripts.
- Exit codes: 0 accept, 1 reject, 2 usage/precondition, 3 infrastructure,
  4 needs_human, 127 engine not found, 130 interrupted.

Known Phase 2 limits:

- Clean worktree required; dirty baselines are rejected.
- Supervision is not a sandbox. Writer defaults to `bypassPermissions`;
  allowlists are post-hoc evidence, not access control.
- Acceptance commands execute the modified repository code by design.
- Local diff cannot detect `git push`, unswitched new branches, or files hidden
  by `.gitignore` edits.

Non-goals for Phase 2:

- A GUI.
- Autonomous merging or pushing.
- Multi-writer swarms.
- A hosted service.

## Phase 3 — Audit trail and benchmarks

- Richer `.lab/tasks/<id>/` records: replayable event timeline and optional
  redacted sharing.
- Deterministic replay of a task's evidence for humans.
- Comparative benchmarks: writer-only vs. writer+auditor on a fixed task set.
- First-class per-role model/provider configuration beyond `LAB_AUDITOR_*`.
- Optional combined writer + auditor reporting modes for CI.

## Explicitly out of scope

- Rebuilding the desktop app.
- Claude/Anthropic branding, OAuth upsells, or upstream marketplaces.
- Telemetry that leaves the machine.

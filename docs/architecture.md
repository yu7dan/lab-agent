# Architecture

## Product boundary

```text
┌──────────────────────────────────────────────┐
│ lab  (src/lab, compiled by build-cli.ts)     │
│                                              │
│  setup   doctor   config   engine passthrough│
│  provider env normalization                  │
│  (future) supervisor orchestration           │
└──────────────────────┬───────────────────────┘
                       │ spawn, inherit stdio
                       ▼
┌──────────────────────────────────────────────┐
│ lab-engine  (src, compiled by build-engine)  │
│                                              │
│  Ink TUI · tools · sessions · permissions    │
│  hooks · MCP · Anthropic-compatible client   │
└──────────────────────────────────────────────┘
```

The wrapper exists so the product can evolve without forking the 1,900-file
engine. Configuration, diagnostics, release branding, and future multi-agent
orchestration live in `src/lab/`. The engine handles one agent session at a time.

## Launch sequence

1. `src/lab/cli.ts` parses reserved commands (`setup`, `doctor`, `config`,
   `engine`, `version`, `help`).
2. For a normal run it calls `applyLabEnvironment()`:
   - creates `~/.lab-agent` if needed;
   - loads `~/.lab-agent/.env`, then the project `.lab-agent.env` without
     overriding shell variables;
   - sets `LAB_AGENT_HOME` / `CLAUDE_CONFIG_DIR`;
   - disables non-essential traffic and telemetry by default;
   - normalizes provider variables.
3. If no API key is available and stdin is a TTY, it offers to run `lab setup`.
4. `findEngineBinary()` locates `lab-engine` (`LAB_ENGINE_PATH`, next to the
   launcher, cwd, then repo root) and spawns it with inherited stdio.
5. The engine's exit code becomes the wrapper's exit code.

## Why the engine stays separate

- **Blast radius**: product changes do not touch the tool/session core.
- **Independent release**: the wrapper can be rebuilt in under a second.
- **Future supervision**: a supervisor can spawn one or more headless engine
  sessions and observe their output without embedding itself in the TUI.
- **Testing**: wrapper logic is plain TypeScript and unit-testable without a
  terminal or model provider.

## Planned supervision layer (Phase 2+)

The intended flow is:

1. The wrapper creates a task contract under `.lab/tasks/<id>/contract.md`.
2. A writer engine session runs headlessly with that contract.
3. A separate, read-only auditor session receives the contract, the diff, and
   tool evidence — not the writer's hidden reasoning.
4. The auditor returns a structured verdict with citations to commands, files,
   and test output.
5. The wrapper records the verdict in `.lab/tasks/<id>/review.json` and either
   accepts the change or asks the writer to address specific findings.

This is deliberately not implemented in 0.3.0. See [roadmap.md](./roadmap.md).

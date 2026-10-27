# Engine

The engine is the execution layer behind the `lab` launcher. It owns the TUI,
tools, sessions, permissions, hooks, MCP integration, and model requests.

The product-facing entrypoint is `src/lab/cli.ts`. The engine entrypoint remains
`src/entrypoints/cli.tsx`.

## Layout

| Path | Role |
| --- | --- |
| `src/entrypoints/cli.tsx` | Engine entrypoint |
| `src/main.tsx` | CLI command registration and interactive startup |
| `src/cli/` | Headless runner, subcommand handlers, transports |
| `src/tools/` | Tool implementations |
| `src/components/` | Ink TUI |
| `src/services/` | API, MCP, OAuth, settings, telemetry services |
| `src/lab/` | Product wrapper (not part of the engine bundle) |
| `scripts/build-engine.ts` | Compiles the engine |
| `scripts/build-cli.ts` | Compiles the `lab` wrapper |

## Build

```bash
bun run build          # ./lab + ./lab-engine
bun run compile        # ./dist/lab + ./dist/lab-engine
bun run build:dev      # dev version string and dev feature set
```

`bun run build:dev:full` enables the experimental feature set defined in
`scripts/build-engine.ts`. Release builds use the default, empty feature set.

The engine is compiled with `bun build --compile --packages bundle`. Native
modules listed in `scripts/build-engine.ts` are marked external.

## Configuration

The wrapper normalizes provider variables before spawning the engine:

| Lab Agent variable | Engine variable |
| --- | --- |
| `DEEPSEEK_API_KEY` | `ANTHROPIC_AUTH_TOKEN`, `DEEPSEEK_API_KEY` |
| `ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` |
| `ANTHROPIC_AUTH_TOKEN` | `ANTHROPIC_AUTH_TOKEN` |
| `BASE_URL` | `ANTHROPIC_BASE_URL` |
| `MODEL` | `ANTHROPIC_MODEL` + per-tier model defaults |

The engine reads its profile from `~/.lab-agent` (`CLAUDE_CONFIG_DIR` is set to
the same directory). `src/utils/labAgentHome.ts` also handles the legacy desktop
profile path if the new directory does not exist.

## Headless invocation used by `lab supervise`

The supervisor spawns the engine twice per round using
`--output-format json`, a fresh `--session-id`, stdin for the task prompt, and
`--no-session-persistence` (no unredacted transcripts on disk).

Writer:

```text
-p --output-format json
--permission-mode bypassPermissions | acceptEdits
--max-turns <n> [--max-budget-usd <n>]
--no-session-persistence --session-id <uuid>
--settings <writer-settings.json>
--append-system-prompt-file <writer-system.md>
```

Auditor:

```text
-p --output-format json
--permission-mode dontAsk
--tools Read,Grep,Glob
--disallowedTools <write/network/shell tools>
--strict-mcp-config --setting-sources=
--settings <auditor-settings.json>
--json-schema <inline verdict schema>
--max-turns <n> [--max-budget-usd <n>] [--model <auditor model>]
--no-session-persistence --session-id <uuid>
--append-system-prompt-file <auditor-system.md>
```

Notes:

- `--json-schema` receives inline JSON, not a file path. The synthetic
  `StructuredOutput` tool is added after `--tools` filtering, so restricting
  the tool pool does not block structured verdicts.
- `--setting-sources=` parses to an empty source list, disabling user, project,
  and local settings; the explicit `--settings` file still applies. Because
  that suppresses the wrapper's automatic `~/.claude` memory guard, the auditor
  settings repeat the deny rules explicitly.
- `--strict-mcp-config` without `--mcp-config` keeps MCP servers out of the
  auditor process.
- Plan mode is not a hard read-only boundary and `acceptEdits` auto-allows
  `mkdir`/`touch`/`rm`/`mv`/`cp`/`sed`, so neither is used for the auditor.
- `--bare` is not used: it changes the tool set and breaks DeepSeek
  `ANTHROPIC_AUTH_TOKEN` authentication.
- Each role receives exactly one provider credential for its resolved endpoint.
  `LAB_AUDITOR_*` is removed from the writer and acceptance environments, and
  acceptance commands run with all provider credentials removed.

## Known limitations

- The source snapshot is missing some type-only modules (for example
  `src/entrypoints/sdk/controlTypes.ts` relative to `src/bridge`), so
  `bun run typecheck:engine` reports errors. Bun builds do not typecheck, so the
  binary still compiles.
- The `src/cli/` runtime directory was restored from a public source mirror that
  matches this snapshot (`src/main.tsx` differs only in branding). Provenance is
  recorded in `NOTICE`.
- Some upstream commands and experimental features remain in the engine. They
  are not part of the Lab Agent product surface and should not be promoted in
  docs or UI.

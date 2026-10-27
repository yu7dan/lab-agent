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

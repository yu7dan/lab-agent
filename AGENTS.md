# AGENTS.md

Guidance for AI coding agents working in this repository. See
<https://agents.md/> for the file convention.

## What this repository is

Lab Agent CLI is a terminal coding agent with two layers:

- `src/lab/` — the product layer: `lab` commands, provider configuration,
  diagnostics, process launch, and supervisor orchestration
  (`src/lab/supervise/`).
- `src/` (everything else) — the execution engine: TUI, tools, sessions,
  permissions, MCP, hooks, and model clients.

The desktop/Electron product and its second agent stack were archived and
removed. Do not add a desktop shell, renderer, or Electron dependency.

## Commands

```bash
bun install
bun run typecheck        # product layer, scripts, tests
bun run test
bun run build            # lab + lab-engine at repo root
bun run build:dev
bun run compile          # dist/lab + dist/lab-engine
bun run clean
```

`bun run typecheck:engine` is not currently a green baseline: the engine
snapshot is missing some type-only modules. Builds use Bun's transpiler, not
`tsc`. Do not “fix” the engine typecheck by adding broad `any` or disabling
checks; keep new product code clean under `tsconfig.lab.json`.

## Project conventions

- Runtime and package manager: **Bun** (>= 1.3.11), TypeScript ESM.
- New product code lives in `src/lab/` and must stay free of React/Ink imports.
  `src/lab/supervise/` may import Node built-ins and other `src/lab` modules
  only.
- Keep supervisor safety properties intact:
  - the auditor never gets write/shell/network tools and never runs acceptance
    commands;
  - acceptance commands and the contract are frozen user input, never generated
    by either model;
  - the deterministic gate can downgrade an auditor `accept` but never upgrade a
    `reject`;
  - malformed or missing auditor verdicts are infrastructure errors, never
    accepts;
  - prompts, artifacts, and forwarded stderr are redacted before writing.
- `lab supervise` tests must use fake deps (fake git, engine output, acceptance
  results). Integration tests may use temporary git repositories but must not
  call a real provider.
- Engine code uses relative imports ending in `.js`, which Bun resolves to
  `.ts`/`.tsx`. Follow the local file's existing import style.
- Keep user-facing strings Chinese where the surrounding surface is Chinese;
  command names, flags, and code identifiers stay English.
- Prefer small, testable helpers over adding logic to `cli.ts`.
- No telemetry or network calls except the provider request explicitly made by
  the engine or `lab doctor`.

## Security and secrets

- NEVER commit `.env`, `lab-agent.env`, `.lab-agent.env`, API keys, tokens, or
  session data. Never commit `.lab/tasks/` contents.
- Mask secrets in output. `maskSecret()` is the standard helper.
- Do not log request headers or full provider responses.
- Do not read another agent's profile (`~/.claude`), memories, or transcripts.
  Lab Agent uses `~/.lab-agent` only, unless the user explicitly requests a
  migration.
- External source code must not be compiled into a binary without explicit user
  approval. Document provenance in `NOTICE` when third-party code is added.

## Branding and licensing

- User-facing surfaces must say **Lab Agent**, never Claude Code, Claude, or the
  upstream project name.
- Do not add Anthropic/Claude links, marketplace URLs, or upsell flows.
- Keep the trademark disclaimer in `NOTICE` accurate when changing branding.
- The project is Apache-2.0; new files should be compatible with that license.

## Testing

- Tests live in `tests/` and run with `bun test tests`.
- Tests must not require a real API key or network access. Use temporary
  directories (`mkdtemp`) and fake environment objects.
- When changing provider normalization, add a table-driven test for DeepSeek,
  Anthropic, and custom endpoints.
- Run `bun run typecheck` and `bun run test` before reporting work complete.

## Git

- Work on a feature branch; do not commit directly to `main` unless asked.
- Do not push or create releases without explicit confirmation.
- Commit messages describe the user-visible change, not the tool used.

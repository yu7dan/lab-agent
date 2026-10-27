# Contributing

Thanks for helping Lab Agent. This repository is CLI-only; the desktop app is
archived and will not be revived.

## Development setup

Requirements:

- Bun 1.3.11 or newer
- Git
- Windows, macOS, or Linux

```bash
git clone https://github.com/yu7dan/lab-agent.git
cd lab-agent
bun install
bun run typecheck
bun run test
bun run build
./lab doctor        # optional: needs a configured provider
```

## What to work on

- Product layer (`src/lab/`): commands, configuration, diagnostics, supervisor
  orchestration.
- Engine (`src/`): tools, TUI, sessions, permissions, provider behavior.
- Docs, tests, installers, CI.

The Phase 2 supervision design is described in [docs/roadmap.md](./docs/roadmap.md).
Please open an issue before starting a large feature so the design can be
discussed first.

## Rules

- **No desktop/Electron code.** Do not reintroduce a GUI stack.
- **No upstream branding.** User-facing text must say Lab Agent, not Claude,
  Claude Code, or the upstream project. Do not add Anthropic upsell links,
  OAuth flows, or marketplaces.
- **No secrets.** Never commit real API keys; tests must use fake values and
  temporary directories.
- **Keep the wrapper small.** New logic in `src/lab/` should be unit-testable
  and should not import React/Ink.
- **External source approval.** Do not add or compile third-party source code
  without recording its origin in `NOTICE` and obtaining maintainer approval.
- **License.** Contributions are accepted under Apache-2.0.

## Checks

Before opening a pull request:

```bash
bun run typecheck
bun run test
bun run build
./lab version
./lab engine --version
```

`bun run typecheck:engine` is not a green baseline yet (the snapshot is missing
some type-only modules). Do not weaken `tsconfig` to hide errors elsewhere.

## Commit and PR style

- Use a feature branch; do not push directly to `main`.
- Write commit messages in the imperative mood, describing the user-visible
  change.
- One logical change per PR. Include tests for behavior changes.
- In the PR description, list what you ran and any platform-specific behavior.
- Do not create releases or push tags; maintainers handle releases.

## Release process (maintainers)

1. Update the version in `package.json` and `CHANGELOG.md` if present.
2. Push a tag such as `v0.3.1`.
3. The release workflow builds `linux-x64`, `linux-arm64`, `darwin-x64`,
   `darwin-arm64`, and `windows-x64` archives, generates `SHA256SUMS`, and
   publishes a GitHub Release.

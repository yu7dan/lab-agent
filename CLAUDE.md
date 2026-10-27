# CLAUDE.md

Read [AGENTS.md](./AGENTS.md) before changing code.

Quick context:

- This repository is **Lab Agent CLI**, not a desktop app. The Electron shell and
  the old `agents/lab-coding` layout were archived and removed.
- `src/lab/` is the product layer (`lab` commands, config, doctor, engine spawn).
- The rest of `src/` is the engine (TUI, tools, sessions, model clients).
- Build with `bun run build`; verify with `bun run typecheck` and `bun run test`.
- Never commit API keys. Lab Agent reads `~/.lab-agent/.env`.
- User-facing branding is **Lab Agent** only; no Claude/upstream branding.

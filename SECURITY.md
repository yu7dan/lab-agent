# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `0.3.x` | Yes (preview) |
| `0.2.x` and older (desktop) | No |

The desktop product is archived on the `archive/desktop` branch and is not
maintained.

## Reporting a vulnerability

Please report security issues privately:

- Preferred: GitHub Security Advisories —
  <https://github.com/yu7dan/lab-agent/security/advisories/new>
- Email: **zfu9751@gmail.com**

Include:

- affected version (`lab version`);
- operating system;
- steps to reproduce;
- impact and any suggested fix;
- whether the issue requires a malicious repository, prompt, MCP server, or
  provider response.

Do **not** include real API keys, tokens, or private source code. Redact them.
Please do not open a public issue before a fix is available.

We aim to acknowledge reports within 72 hours and to publish a coordinated fix
and advisory when appropriate.

## Key handling

- `lab setup` writes credentials to `~/.lab-agent/.env` with user-only
  permissions where the OS supports it.
- `lab config` and `lab doctor` print masked keys only.
- Lab Agent does not transmit keys anywhere except the provider endpoint you
  configure.
- Never commit `.env`, `lab-agent.env`, `.lab-agent.env`, or shell history
  containing keys. `.lab-agent.env` is ignored by the repository `.gitignore`.
- `lab supervise` redacts configured credentials from prompts, diffs, logs, and
  reports before writing them under `.lab/tasks/`. Session transcripts are not
  persisted (`--no-session-persistence`).
- Acceptance commands run with provider credentials removed from their
  environment; `LAB_AUDITOR_*` is removed from writer and acceptance
  environments.

## Telemetry and network access

Lab Agent disables non-essential traffic and telemetry by default:

```dotenv
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
DISABLE_TELEMETRY=1
```

Network requests happen when:

- the engine calls your configured model provider;
- `lab doctor` performs an explicit endpoint check;
- a tool such as `WebFetch` is invoked by the agent;
- an MCP server configured by you is contacted.

## Threat model notes

A coding agent executes commands and edits files. Treat a repository, prompt, or
MCP server you did not author as untrusted input.

- Review permission prompts before approving shell commands.
- Do not run with `--dangerously-skip-permissions` outside a disposable sandbox.
- Prompt injection can arrive through files, web pages, tool output, or MCP
  servers. The engine surfaces warnings, but it cannot eliminate this risk.
- Release archives include `SHA256SUMS`; installation scripts verify it when the
  required hashing tool is available.

## `lab supervise` threat model

`lab supervise` runs one writer agent and one independent auditor agent. It is a
review workflow, **not a sandbox**.

- **Writer permissions.** On Windows there is no OS sandbox. The writer defaults
  to `--permission-mode bypassPermissions` and can execute any command your user
  account can. Start with `--writer-mode acceptEdits` to tighten this, but note
  that headless `acceptEdits` auto-allows `mkdir`/`touch`/`rm`/`mv`/`cp`/`sed`
  and may still reject test commands. supervise only against repositories and
  acceptance commands you trust.
- **Allowlists are evidence, not enforcement.** `--allow` is checked after the
  round. It does not prevent the writer from touching other files; it makes
  those changes a blocking gate failure.
- **Acceptance commands execute repository code.** This is inherent to running
  tests on the writer's changes. Commands come only from your CLI/contract file,
  never from the model. Run untrusted repositories in a container or disposable
  clone.
- **Auditor isolation.** The auditor runs with `Read`/`Grep`/`Glob` only,
  `dontAsk`, no MCP (`--strict-mcp-config`), no user/project/local setting
  sources, and explicit deny rules for `~/.claude`, `~/.lab-agent`, `.git`,
  `.lab`, and secret file patterns. It has no shell, so it cannot run commands;
  the wrapper supplies acceptance output. Managed hooks may still run despite
  `disableAllHooks`; the auditor has no write tools, which bounds this risk.
- **Prompt injection.** Repository content, diffs, and test output are treated
  as untrusted data in the auditor prompt. The deterministic gate still forces
  `reject` on failed acceptance, path violations, sensitive-file changes, or a
  HEAD change, so an injected auditor cannot approve those. Human review of
  `verdict.json` is still recommended.
- **Git blind spots.** Local evidence cannot detect `git push`, unswitched new
  branches, or files hidden by edits to `.gitignore`. `.gitignore` changes do
  appear in the diff. A newly created secret file that is already ignored (for
  example `.env` in a repository that ignores it) does not appear in
  `git status`; it is also excluded from the snapshot, so it is not shown to
  the auditor. Do not keep secrets in a supervised worktree. The temp-index
  snapshot still writes changed non-secret blobs into `.git/objects`.
- **Dirty worktrees are refused** so the baseline is unambiguous. Commit or
  stash before supervising.
- **Artifacts may contain sensitive project data** (diff, test output). They are
  written under `.lab/tasks/` with user-only permissions where supported and
  excluded by a nested `.gitignore`; review before sharing.

When stronger isolation is required, run the whole command inside a container,
VM, or fresh clone with limited credentials.

## Dependency and source provenance

The engine includes code derived from a public source snapshot. Provenance and
trademark attribution are documented in [NOTICE](./NOTICE). Security fixes in
third-party components should be reported upstream as well as here.

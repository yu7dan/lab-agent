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
- Never commit `.env`, `lab-agent.env`, or shell history containing keys.

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

## Dependency and source provenance

The engine includes code derived from a public source snapshot. Provenance and
trademark attribution are documented in [NOTICE](./NOTICE). Security fixes in
third-party components should be reported upstream as well as here.

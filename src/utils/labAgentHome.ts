import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

type Environment = Record<string, string | undefined>

/** Old per-user profile locations used by the desktop shell and earlier CLI builds. */
function legacyLabAgentHome(
  platform: NodeJS.Platform,
  env: Environment,
  homeDir: string,
  pathApi: typeof path.win32 | typeof path.posix,
): string {
  if (platform === 'darwin') {
    return pathApi.join(homeDir, 'Library', 'Application Support', 'Lab Agent', 'lab-coding-config')
  }
  if (platform === 'win32') {
    const appData = env.APPDATA?.trim() || path.win32.join(homeDir, 'AppData', 'Roaming')
    return path.win32.join(appData, 'Lab Agent', 'lab-coding-config')
  }
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.posix.join(homeDir, '.config')
  return path.posix.join(configHome, 'Lab Agent', 'lab-coding-config')
}

/**
 * Resolve Lab Agent's per-user profile.
 *
 * New installs use `~/.lab-agent`. Existing installations keep working from
 * the old desktop-compatible location until the user migrates.
 */
export function resolveLabAgentHome(
  platform: NodeJS.Platform = process.platform,
  env: Environment = process.env,
  homeDir = homedir(),
): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const explicit = env.LAB_AGENT_HOME?.trim()
  if (explicit && pathApi.isAbsolute(explicit)) return pathApi.normalize(explicit)

  const home = pathApi.join(homeDir, '.lab-agent')
  const legacy = legacyLabAgentHome(platform, env, homeDir, pathApi)
  if (existsSync(home)) return home
  if (existsSync(legacy)) return legacy
  return home
}

/**
 * Point the engine's storage alias at Lab Agent's own home, remove inherited
 * redirections from other agents, and keep non-essential traffic off unless
 * the user explicitly opts in.
 */
export function initializeLabAgentEnvironment(): string {
  const home = resolveLabAgentHome()
  process.env.LAB_AGENT_HOME = home
  process.env.CLAUDE_CONFIG_DIR = home
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ??= '1'
  process.env.DISABLE_TELEMETRY ??= '1'
  delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
  delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  delete process.env.CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_USE_COWORK_PLUGINS
  delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  delete process.env.CLAUDE_CODE_SIMPLE
  return home
}

/**
 * Default read boundary shared by terminal sessions when no user settings
 * override is supplied. Lab Agent should not read another agent's private
 * profile unless the user explicitly asks for a migration.
 */
export function labAgentMemoryGuardSettings(): string {
  return JSON.stringify({
    permissions: {
      deny: [
        'Read(~/.claude)',
        'Read(~/.claude/**)',
        'Grep(~/.claude)',
        'Grep(~/.claude/**)',
        'Glob(~/.claude)',
        'Glob(~/.claude/**)',
        'Bash(*.claude*)',
        'PowerShell(*.claude*)',
      ],
    },
    sandbox: { filesystem: { denyRead: ['~/.claude'] } },
  })
}

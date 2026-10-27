import { mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { InfraError, UsageError } from './errors.js'
import { normalizeRepoPath } from './contract.js'
import { runProcessCaptured } from './process.js'

export interface GitStatusEntry {
  status: string
  path: string
  oldPath?: string
}

export interface GitBaseline {
  head: string
  tree: string
  status: string
}

export interface GitSnapshot {
  head: string
  tree: string
}

export interface GitClient {
  readonly repoRoot: string
  head(): Promise<string>
  status(): Promise<string>
  baseline(): Promise<GitBaseline>
  snapshot(baselineTree: string, indexFile: string): Promise<GitSnapshot>
  changedPaths(fromTree: string, toTree: string): Promise<string[]>
  diff(fromTree: string, toTree: string): Promise<string>
  diffStat(fromTree: string, toTree: string): Promise<string>
}

const STATUS_EXCLUDES = ['.', ':(exclude).lab']
const SNAPSHOT_EXCLUDES = [
  '.',
  ':(exclude).lab',
  ':(exclude).lab/**',
  ':(exclude,glob).env',
  ':(exclude,glob).env.local',
  ':(exclude,glob).env.*.local',
  ':(exclude,glob).lab-agent.env',
  ':(exclude,glob)*.pem',
  ':(exclude,glob)*.key',
  ':(exclude,glob)id_rsa*',
  ':(exclude,glob)id_ed25519*',
  ':(exclude,glob)**/.env',
  ':(exclude,glob)**/.env.local',
  ':(exclude,glob)**/.env.*.local',
  ':(exclude,glob)**/.lab-agent.env',
  ':(exclude,glob)**/*.pem',
  ':(exclude,glob)**/*.key',
  ':(exclude,glob)**/id_rsa*',
  ':(exclude,glob)**/id_ed25519*',
]

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_WORK_TREE
  delete env.GIT_INDEX_FILE
  delete env.GIT_OBJECT_DIRECTORY
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES
  delete env.GIT_PREFIX
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  return env
}

function tail(text: string, maxChars = 2000): string {
  const trimmed = text.trim()
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(-maxChars)
}

export function parsePorcelainZ(text: string): GitStatusEntry[] {
  if (!text) return []
  const tokens = text.split('\0')
  const entries: GitStatusEntry[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (!token) continue
    if (token.length < 4) continue
    const status = token.slice(0, 2)
    const path = token.slice(3)
    if (!path) continue

    const entry: GitStatusEntry = { status, path }
    if (status.includes('R') || status.includes('C')) {
      const other = tokens[i + 1]
      if (other) {
        entry.oldPath = other
        i++
      }
    }
    entries.push(entry)
  }
  return entries
}

/**
 * Create a git client rooted at the worktree containing `cwd`. All subsequent
 * commands run with that worktree as cwd, so supervision started from a
 * subdirectory still evaluates the whole repository.
 */
export async function createGitClient(cwd: string): Promise<GitClient> {
  const env = gitEnv()
  const rootResult = await runProcessCaptured(
    'git',
    ['rev-parse', '--show-toplevel'],
    {
      cwd,
      env,
      timeoutMs: 30_000,
      maxStdoutBytes: 1024 * 1024,
      maxStderrBytes: 1024 * 1024,
    },
  )
  if (rootResult.spawnError) {
    throw new InfraError(`无法运行 git: ${rootResult.spawnError}`)
  }
  if (rootResult.code !== 0) {
    throw new UsageError(
      `当前目录不是 git 仓库（或 git 不可用）: ${cwd}\n${tail(rootResult.stderr)}`,
    )
  }
  const repoRoot = resolve(rootResult.stdout.trim())
  if (!repoRoot) {
    throw new UsageError(`无法解析 git 仓库根目录: ${cwd}`)
  }

  async function runGit(
    args: string[],
    extraEnv?: NodeJS.ProcessEnv,
    maxStdoutBytes = 64 * 1024 * 1024,
  ): Promise<string> {
    const result = await runProcessCaptured('git', args, {
      cwd: repoRoot,
      env: { ...env, ...extraEnv },
      timeoutMs: 120_000,
      maxStdoutBytes,
      maxStderrBytes: 4 * 1024 * 1024,
    })
    if (result.spawnError) {
      throw new InfraError(`无法运行 git ${args[0] ?? ''}: ${result.spawnError}`)
    }
    if (result.timedOut) {
      throw new InfraError(`git ${args[0] ?? ''} 超时`)
    }
    if (result.aborted) {
      throw new InfraError(`git ${args[0] ?? ''} 被中断`)
    }
    if (result.code !== 0) {
      throw new InfraError(
        `git ${args[0] ?? ''} 失败（exit ${result.code}）: ${tail(result.stderr)}`,
      )
    }
    return result.stdout
  }

  async function head(): Promise<string> {
    const result = await runProcessCaptured(
      'git',
      ['rev-parse', '--verify', 'HEAD^{commit}'],
      {
        cwd: repoRoot,
        env,
        timeoutMs: 30_000,
        maxStdoutBytes: 1024 * 1024,
        maxStderrBytes: 1024 * 1024,
      },
    )
    if (result.spawnError) {
      throw new InfraError(`无法运行 git: ${result.spawnError}`)
    }
    if (result.code !== 0) {
      throw new UsageError(
        '仓库还没有任何 commit，无法建立监督基线。请先提交当前内容。',
      )
    }
    return result.stdout.trim()
  }

  async function status(): Promise<string> {
    return runGit(['status', '--porcelain=v1', '-z', '-uall', '--', ...STATUS_EXCLUDES])
  }

  const client: GitClient = {
    repoRoot,
    head,
    status,
    async baseline(): Promise<GitBaseline> {
      const headValue = await head()
      const treeValue = (await runGit(['rev-parse', 'HEAD^{tree}'], undefined, 1024 * 1024)).trim()
      const statusValue = await status()
      return { head: headValue, tree: treeValue, status: statusValue }
    },
    async snapshot(
      baselineTree: string,
      indexFile: string,
    ): Promise<GitSnapshot> {
      const absoluteIndex = resolve(indexFile)
      mkdirSync(dirname(absoluteIndex), { recursive: true, mode: 0o700 })
      rmSync(absoluteIndex, { force: true })
      const extraEnv = { GIT_INDEX_FILE: absoluteIndex }
      try {
        await runGit(['read-tree', baselineTree], extraEnv)
        await runGit(['add', '-A', '--', ...SNAPSHOT_EXCLUDES], extraEnv)
        const tree = (await runGit(['write-tree'], extraEnv, 1024 * 1024)).trim()
        const headAfter = await head()
        return { head: headAfter, tree }
      } finally {
        rmSync(absoluteIndex, { force: true })
      }
    },
    async changedPaths(fromTree: string, toTree: string): Promise<string[]> {
      const output = await runGit([
        'diff',
        '--name-only',
        '-z',
        '--no-renames',
        '--no-ext-diff',
        fromTree,
        toTree,
      ])
      const seen = new Set<string>()
      const paths: string[] = []
      for (const raw of output.split('\0')) {
        if (!raw) continue
        const path = normalizeRepoPath(raw)
        if (!seen.has(path)) {
          seen.add(path)
          paths.push(path)
        }
      }
      return paths
    },
    async diff(fromTree: string, toTree: string): Promise<string> {
      return runGit([
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        fromTree,
        toTree,
      ])
    },
    async diffStat(fromTree: string, toTree: string): Promise<string> {
      return runGit(
        ['diff', '--stat', '--no-color', '--no-ext-diff', '--no-renames', fromTree, toTree],
        undefined,
        4 * 1024 * 1024,
      )
    },
  }

  return client
}

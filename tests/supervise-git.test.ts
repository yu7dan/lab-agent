import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { UsageError } from '../src/lab/supervise/errors.js'
import {
  createGitClient,
  parsePorcelainZ,
} from '../src/lab/supervise/git.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lab-agent-git-'))
  tempDirs.push(dir)
  return dir
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

function makeRepo(): string {
  const dir = makeTempDir()
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Lab Agent Test'])
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  git(dir, ['add', '.'])
  git(dir, ['commit', '-q', '-m', 'init'])
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('parsePorcelainZ', () => {
  test('parses modified, untracked, renamed, and copied entries', () => {
    const text =
      ' M a.txt\0' +
      '?? b c.txt\0' +
      'R  new.txt\0old.txt\0' +
      'C  copy.txt\0source.txt\0'
    expect(parsePorcelainZ(text)).toEqual([
      { status: ' M', path: 'a.txt' },
      { status: '??', path: 'b c.txt' },
      { status: 'R ', path: 'new.txt', oldPath: 'old.txt' },
      { status: 'C ', path: 'copy.txt', oldPath: 'source.txt' },
    ])
  })

  test('handles empty and malformed input', () => {
    expect(parsePorcelainZ('')).toEqual([])
    expect(parsePorcelainZ('\0\0')).toEqual([])
    expect(parsePorcelainZ('??\0')).toEqual([])
  })
})

describe('createGitClient', () => {
  test('rejects directories outside a git repository', async () => {
    const dir = makeTempDir()
    await expect(createGitClient(dir)).rejects.toBeInstanceOf(UsageError)
  })

  test('requires at least one commit for a baseline', async () => {
    const dir = makeTempDir()
    git(dir, ['init', '-q'])
    const client = await createGitClient(dir)
    await expect(client.baseline()).rejects.toBeInstanceOf(UsageError)
  })

  test('reports a clean baseline and resolves the repository root', async () => {
    const dir = makeRepo()
    const nested = join(dir, 'nested')
    mkdirSync(nested)
    const client = await createGitClient(nested)

    expect(resolve(client.repoRoot).toLowerCase()).toBe(
      resolve(realpathSync(dir)).toLowerCase(),
    )
    const baseline = await client.baseline()
    expect(baseline.head).toMatch(/^[0-9a-f]{40}$/)
    expect(baseline.tree).toMatch(/^[0-9a-f]{40}$/)
    expect(baseline.status).toBe('')
    expect(await client.head()).toBe(baseline.head)
  })

  test('snapshots modified and untracked files without touching the real index', async () => {
    const dir = makeRepo()
    const client = await createGitClient(dir)
    const baseline = await client.baseline()

    writeFileSync(join(dir, 'a.txt'), 'two\n')
    writeFileSync(join(dir, 'new.txt'), 'new file\n')
    mkdirSync(join(dir, '.lab'), { recursive: true })
    writeFileSync(join(dir, '.lab', 'note.txt'), 'artifact\n')
    writeFileSync(join(dir, '.env'), 'SECRET=value\n')

    const snapshot = await client.snapshot(
      baseline.tree,
      join(dir, '.lab', 'test-index'),
    )
    expect(snapshot.head).toBe(baseline.head)

    const changed = await client.changedPaths(baseline.tree, snapshot.tree)
    expect(changed.sort()).toEqual(['a.txt', 'new.txt'])

    const diff = await client.diff(baseline.tree, snapshot.tree)
    expect(diff).toContain('-one')
    expect(diff).toContain('+two')
    expect(diff).toContain('+new file')

    const stat = await client.diffStat(baseline.tree, snapshot.tree)
    expect(stat).toContain('a.txt')
    expect(stat).toContain('new.txt')

    // The snapshot must not stage anything in the user's real index.
    expect(git(dir, ['diff', '--cached', '--name-only'])).toBe('')
    expect(existsSync(join(dir, '.lab', 'test-index'))).toBe(false)

    const status = await client.status()
    const entries = parsePorcelainZ(status)
    expect(entries.some((entry) => entry.path === 'a.txt')).toBe(true)
    expect(entries.some((entry) => entry.path === 'new.txt')).toBe(true)
    expect(entries.some((entry) => entry.path === '.env')).toBe(true)
    expect(entries.some((entry) => entry.path.startsWith('.lab'))).toBe(false)
  })

  test('treats renames as delete plus add', async () => {
    const dir = makeRepo()
    const client = await createGitClient(dir)
    const baseline = await client.baseline()

    git(dir, ['mv', 'a.txt', 'renamed.txt'])
    const snapshot = await client.snapshot(
      baseline.tree,
      join(dir, '.lab', 'test-index'),
    )
    const changed = await client.changedPaths(baseline.tree, snapshot.tree)
    expect(changed.sort()).toEqual(['a.txt', 'renamed.txt'])
  })
})

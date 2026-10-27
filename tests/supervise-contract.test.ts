import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isPathAllowed,
  isSensitiveRepoPath,
  loadContractFile,
  normalizeAllowedPath,
  parseSuperviseArgs,
  resolveContract,
} from '../src/lab/supervise/contract.js'
import { UsageError } from '../src/lab/supervise/errors.js'
import type { FileContract } from '../src/lab/supervise/types.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lab-agent-contract-'))
  tempDirs.push(dir)
  return dir
}

function writeJson(value: unknown): string {
  const file = join(makeTempDir(), 'contract.json')
  writeFileSync(file, JSON.stringify(value))
  return file
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseSuperviseArgs', () => {
  test('collects a positional goal and repeatable flags', () => {
    const parsed = parseSuperviseArgs([
      'fix',
      'the',
      'bug',
      '--accept',
      'bun test',
      '--accept=bun run typecheck',
      '--allow',
      'src/',
      '--allow=./tests/',
      '--constraint',
      'do not change the API',
      '--max-rounds',
      '3',
      '--writer-mode=acceptEdits',
      '--timeout',
      '120',
      '--accept-timeout=30',
      '--max-turns',
      '10',
      '--writer-budget-usd',
      '2.5',
      '--json',
      '--verbose',
    ])

    expect(parsed.goal).toBe('fix the bug')
    expect(parsed.accept).toEqual(['bun test', 'bun run typecheck'])
    expect(parsed.allow).toEqual(['src/', './tests/'])
    expect(parsed.constraints).toEqual(['do not change the API'])
    expect(parsed.maxRounds).toBe(3)
    expect(parsed.writerMode).toBe('acceptEdits')
    expect(parsed.writerTimeoutSec).toBe(120)
    expect(parsed.acceptTimeoutSec).toBe(30)
    expect(parsed.writerMaxTurns).toBe(10)
    expect(parsed.writerBudgetUsd).toBe(2.5)
    expect(parsed.json).toBe(true)
    expect(parsed.verbose).toBe(true)
  })

  test('treats everything after -- as the goal', () => {
    const parsed = parseSuperviseArgs([
      '--accept',
      'echo ok',
      '--allow',
      '.',
      '--',
      '--not-a-flag',
    ])
    expect(parsed.goal).toBe('--not-a-flag')
  })

  test('--help wins even with invalid trailing flags', () => {
    const parsed = parseSuperviseArgs(['--help', '--nope'])
    expect(parsed.help).toBe(true)
  })

  test('rejects unknown flags, missing values, and invalid values', () => {
    expect(() => parseSuperviseArgs(['--nope'])).toThrow(UsageError)
    expect(() => parseSuperviseArgs(['-x'])).toThrow(UsageError)
    expect(() => parseSuperviseArgs(['--accept'])).toThrow(UsageError)
    expect(() => parseSuperviseArgs(['--json=1'])).toThrow(UsageError)
    expect(() => parseSuperviseArgs(['--max-rounds', '11'])).toThrow(UsageError)
    expect(() => parseSuperviseArgs(['--max-rounds', '1.5'])).toThrow(UsageError)
    expect(() => parseSuperviseArgs(['--timeout', '0'])).toThrow(UsageError)
    expect(() => parseSuperviseArgs(['--max-turns', '501'])).toThrow(UsageError)
    expect(() => parseSuperviseArgs(['--writer-mode', 'yolo'])).toThrow(
      UsageError,
    )
    expect(() => parseSuperviseArgs(['--writer-budget-usd', '0'])).toThrow(
      UsageError,
    )
  })
})

describe('normalizeAllowedPath', () => {
  test('normalizes relative POSIX paths and keeps .', () => {
    expect(normalizeAllowedPath('src')).toBe('src')
    expect(normalizeAllowedPath('./src/')).toBe('src')
    expect(normalizeAllowedPath('src/lib/')).toBe('src/lib')
    expect(normalizeAllowedPath('.')).toBe('.')
  })

  test('rejects unsafe and ambiguous paths', () => {
    for (const value of [
      '/abs',
      'C:/abs',
      'src\\lib',
      '../src',
      'src/../lib',
      'src//lib',
      'src/*',
      '.git',
      '.git/config',
      '.lab',
      '.lab/tasks',
      'src:lib',
      '',
    ]) {
      expect(() => normalizeAllowedPath(value)).toThrow(UsageError)
    }
  })
})

describe('isPathAllowed', () => {
  test('matches on segment boundaries', () => {
    expect(isPathAllowed('src/a.ts', ['src'], 'linux')).toBe(true)
    expect(isPathAllowed('src/a.ts', ['src/'], 'linux')).toBe(true)
    expect(isPathAllowed('src2/a.ts', ['src'], 'linux')).toBe(false)
    expect(isPathAllowed('src', ['src'], 'linux')).toBe(true)
    expect(isPathAllowed('anything', ['.'], 'linux')).toBe(true)
  })

  test('is case-insensitive on Windows only', () => {
    expect(isPathAllowed('SRC/a.ts', ['src'], 'win32')).toBe(true)
    expect(isPathAllowed('SRC/a.ts', ['src'], 'linux')).toBe(false)
  })
})

describe('isSensitiveRepoPath', () => {
  test('detects env files and private keys anywhere in the tree', () => {
    for (const value of [
      '.env',
      '.env.local',
      '.env.production.local',
      '.lab-agent.env',
      'nested/.env',
      'keys/server.pem',
      'certs/server.key',
      'home/id_rsa',
      'home/id_ed25519.pub',
    ]) {
      expect(isSensitiveRepoPath(value)).toBe(true)
    }
    expect(isSensitiveRepoPath('src/env.ts')).toBe(false)
    expect(isSensitiveRepoPath('.env.example')).toBe(false)
    expect(isSensitiveRepoPath('docs/key.md')).toBe(false)
  })
})

describe('resolveContract', () => {
  test('applies defaults', () => {
    const parsed = parseSuperviseArgs([
      'fix it',
      '--accept',
      'echo ok',
      '--allow',
      'src',
    ])
    const contract = resolveContract(parsed, null)

    expect(contract.goal).toBe('fix it')
    expect(contract.acceptance).toEqual([
      { name: 'acceptance 1', command: 'echo ok', timeoutSec: 600 },
    ])
    expect(contract.allowedPaths).toEqual(['src'])
    expect(contract.maxRounds).toBe(2)
    expect(contract.writerMode).toBe('bypass')
    expect(contract.writerTimeoutSec).toBe(1800)
    expect(contract.acceptTimeoutSec).toBe(600)
    expect(contract.writerMaxTurns).toBe(60)
    expect(contract.writerBudgetUsd).toBeUndefined()
    expect(contract.contractHash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('CLI arrays replace contract arrays and CLI scalars win', () => {
    const parsed = parseSuperviseArgs([
      'cli goal',
      '--accept',
      'cli test',
      '--allow',
      'cli-src',
      '--constraint',
      'cli constraint',
      '--max-rounds',
      '1',
      '--writer-mode',
      'acceptEdits',
    ])
    const file: FileContract = {
      goal: 'file goal',
      constraints: ['file constraint'],
      allowedPaths: ['file-src'],
      acceptance: [{ name: 'file test', command: 'file test', timeoutSec: 5 }],
      maxRounds: 7,
      writerMode: 'bypass',
      writerMaxTurns: 3,
    }

    const contract = resolveContract(parsed, file)
    expect(contract.goal).toBe('cli goal')
    expect(contract.constraints).toEqual(['cli constraint'])
    expect(contract.allowedPaths).toEqual(['cli-src'])
    expect(contract.acceptance).toEqual([
      { name: 'acceptance 1', command: 'cli test', timeoutSec: 600 },
    ])
    expect(contract.maxRounds).toBe(1)
    expect(contract.writerMode).toBe('acceptEdits')
    expect(contract.writerMaxTurns).toBe(3)
  })

  test('uses contract values when CLI arrays are absent', () => {
    const parsed = parseSuperviseArgs([])
    const file: FileContract = {
      goal: 'file goal',
      constraints: ['a', 'a', 'b'],
      allowedPaths: ['src', './src/', 'tests'],
      acceptance: [
        'bun test',
        { name: 'typecheck', command: 'bun run typecheck', timeoutSec: 42 },
      ],
      acceptTimeoutSec: 90,
    }

    const contract = resolveContract(parsed, file)
    expect(contract.goal).toBe('file goal')
    expect(contract.constraints).toEqual(['a', 'b'])
    expect(contract.allowedPaths).toEqual(['src', 'tests'])
    expect(contract.acceptance).toEqual([
      { name: 'acceptance 1', command: 'bun test', timeoutSec: 90 },
      { name: 'typecheck', command: 'bun run typecheck', timeoutSec: 42 },
    ])
  })

  test('requires a goal, at least one acceptance command, and one allowed path', () => {
    expect(() => resolveContract(parseSuperviseArgs([]), null)).toThrow(
      UsageError,
    )
    expect(() =>
      resolveContract(parseSuperviseArgs(['goal', '--allow', 'src']), null),
    ).toThrow(UsageError)
    expect(() =>
      resolveContract(parseSuperviseArgs(['goal', '--accept', 'echo']), null),
    ).toThrow(UsageError)
  })

  test('contract hash is stable and sensitive to the contract content', () => {
    const parsed = parseSuperviseArgs([
      'goal',
      '--accept',
      'echo ok',
      '--allow',
      'src',
    ])
    const first = resolveContract(parsed, null)
    const second = resolveContract(parsed, null)
    expect(first.contractHash).toBe(second.contractHash)

    const other = resolveContract(
      parseSuperviseArgs(['other', '--accept', 'echo ok', '--allow', 'src']),
      null,
    )
    expect(other.contractHash).not.toBe(first.contractHash)
  })
})

describe('loadContractFile', () => {
  test('loads a full version 1 contract', () => {
    const file = writeJson({
      version: 1,
      goal: '  fix it  ',
      constraints: ['keep the API'],
      allowedPaths: ['src/'],
      acceptance: [
        'bun test',
        { name: 'typecheck', command: 'bun run typecheck', timeoutSec: 120 },
      ],
      maxRounds: 1,
      writerMode: 'acceptEdits',
      writerTimeoutSec: 60,
      acceptTimeoutSec: 30,
      writerMaxTurns: 9,
      writerBudgetUsd: 1.5,
    })

    const contract = loadContractFile(file)
    expect(contract.goal).toBe('fix it')
    expect(contract.acceptance).toEqual([
      'bun test',
      { name: 'typecheck', command: 'bun run typecheck', timeoutSec: 120 },
    ])
    expect(contract.maxRounds).toBe(1)
    expect(contract.writerMode).toBe('acceptEdits')
    expect(contract.writerBudgetUsd).toBe(1.5)
  })

  test('rejects unsupported versions and malformed JSON', () => {
    expect(() => loadContractFile(writeJson({ version: 2 }))).toThrow(UsageError)
    expect(() => loadContractFile(writeJson([]))).toThrow(UsageError)

    const badJson = join(makeTempDir(), 'bad.json')
    writeFileSync(badJson, '{nope')
    expect(() => loadContractFile(badJson)).toThrow(UsageError)
  })

  test('rejects invalid field types and ranges', () => {
    expect(() =>
      loadContractFile(
        writeJson({ goal: 1, allowedPaths: ['src'], acceptance: ['echo'] }),
      ),
    ).toThrow(UsageError)
    expect(() =>
      loadContractFile(
        writeJson({ goal: 'x', allowedPaths: ['src'], acceptance: [123] }),
      ),
    ).toThrow(UsageError)
    expect(() =>
      loadContractFile(
        writeJson({
          goal: 'x',
          allowedPaths: ['src'],
          acceptance: ['echo'],
          maxRounds: 11,
        }),
      ),
    ).toThrow(UsageError)
    expect(() =>
      loadContractFile(
        writeJson({
          goal: 'x',
          allowedPaths: ['src'],
          acceptance: [{ command: 'echo', timeoutSec: 0 }],
        }),
      ),
    ).toThrow(UsageError)
  })

  test('rejects files larger than 1 MiB', () => {
    const file = join(makeTempDir(), 'large.json')
    writeFileSync(file, JSON.stringify({ goal: 'x'.repeat(1024 * 1024) }))
    expect(() => loadContractFile(file)).toThrow(UsageError)
  })
})

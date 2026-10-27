import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findEngineBinary } from '../src/lab/engine.js'

const engineName = process.platform === 'win32' ? 'lab-engine.exe' : 'lab-engine'
const devEngineName =
  process.platform === 'win32' ? 'lab-engine-dev.exe' : 'lab-engine-dev'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lab-agent-engine-'))
  tempDirs.push(dir)
  return dir
}

function makeEngine(dir: string, name = engineName): string {
  const path = join(dir, name)
  writeFileSync(path, '')
  if (process.platform !== 'win32') chmodSync(path, 0o755)
  return path
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('findEngineBinary', () => {
  test('prefers LAB_ENGINE_PATH', () => {
    const explicitDir = makeTempDir()
    const binDir = makeTempDir()
    const explicit = makeEngine(explicitDir)
    makeEngine(binDir)

    const found = findEngineBinary(
      { LAB_ENGINE_PATH: explicit },
      join(binDir, 'lab'),
      binDir,
      makeTempDir(),
    )
    expect(found).toEqual({ path: explicit, source: 'LAB_ENGINE_PATH' })
  })

  test('finds the engine next to the launcher', () => {
    const binDir = makeTempDir()
    const engine = makeEngine(binDir)

    const found = findEngineBinary(
      {},
      join(binDir, process.platform === 'win32' ? 'lab.exe' : 'lab'),
      makeTempDir(),
      makeTempDir(),
    )
    expect(found).toEqual({ path: engine, source: 'executable-dir' })
  })

  test('falls back to the current directory', () => {
    const cwd = makeTempDir()
    const engine = makeEngine(cwd)

    const found = findEngineBinary(
      {},
      join(makeTempDir(), 'lab'),
      cwd,
      makeTempDir(),
    )
    expect(found).toEqual({ path: engine, source: 'cwd' })
  })

  test('falls back to the repository root', () => {
    const repoRoot = makeTempDir()
    const engine = makeEngine(repoRoot)

    const found = findEngineBinary(
      {},
      join(makeTempDir(), 'lab'),
      makeTempDir(),
      repoRoot,
    )
    expect(found).toEqual({ path: engine, source: 'repo' })
  })

  test('accepts a dev engine', () => {
    const binDir = makeTempDir()
    const engine = makeEngine(binDir, devEngineName)

    const found = findEngineBinary(
      {},
      join(binDir, 'lab'),
      makeTempDir(),
      makeTempDir(),
    )
    expect(found).toEqual({ path: engine, source: 'executable-dir' })
  })

  test('ignores a missing LAB_ENGINE_PATH and returns null when absent', () => {
    const found = findEngineBinary(
      { LAB_ENGINE_PATH: join(makeTempDir(), 'missing-engine') },
      join(makeTempDir(), 'lab'),
      makeTempDir(),
      makeTempDir(),
    )
    expect(found).toBeNull()
  })
})

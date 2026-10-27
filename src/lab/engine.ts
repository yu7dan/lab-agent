import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function moduleDir(): string {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return process.cwd()
  }
}

export interface EngineLocation {
  path: string
  source: 'LAB_ENGINE_PATH' | 'executable-dir' | 'cwd' | 'repo'
}

/** Find the engine binary that ships next to the `lab` launcher. */
export function findEngineBinary(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
  cwd: string = process.cwd(),
  repoRoot: string = resolve(moduleDir(), '..', '..'),
): EngineLocation | null {
  const explicit = env.LAB_ENGINE_PATH?.trim()
  if (explicit && existsSync(explicit)) {
    return { path: explicit, source: 'LAB_ENGINE_PATH' }
  }

  const names =
    process.platform === 'win32'
      ? ['lab-engine.exe', 'lab-engine-dev.exe']
      : ['lab-engine', 'lab-engine-dev']
  const candidates: Array<{ dir: string; source: EngineLocation['source'] }> = [
    { dir: dirname(execPath), source: 'executable-dir' },
    { dir: cwd, source: 'cwd' },
    { dir: repoRoot, source: 'repo' },
  ]

  for (const candidate of candidates) {
    for (const name of names) {
      const path = join(candidate.dir, name)
      if (existsSync(path)) return { path, source: candidate.source }
    }
  }
  return null
}

export function runEngine(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const engine = findEngineBinary(env)
  if (!engine) {
    console.error(
      '未找到 lab-engine。请先运行 `bun run build`，' +
        '或设置 LAB_ENGINE_PATH 指向引擎二进制。',
    )
    return Promise.resolve(127)
  }

  return new Promise((resolvePromise) => {
    const child = spawn(engine.path, args, {
      stdio: 'inherit',
      env,
      windowsHide: false,
    })

    child.on('error', (error) => {
      console.error(`无法启动 lab-engine: ${error.message}`)
      resolvePromise(127)
    })
    child.on('exit', (code, signal) => {
      if (signal) {
        resolvePromise(128)
        return
      }
      resolvePromise(code ?? 1)
    })
  })
}

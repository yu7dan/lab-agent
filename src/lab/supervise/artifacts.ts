import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { isPathInside } from './contract.js'
import { redactDeep } from './evidence.js'
import type { Redactor } from './evidence.js'
import { InfraError } from './errors.js'

const TASK_ID_PATTERN = /^\d{8}T\d{6}-[0-9a-f]{6}$/

export function createTaskId(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace(/Z$/, '')
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

function chmodQuiet(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch {
    // Windows does not fully support POSIX modes.
  }
}

function assertSafeDirectory(path: string, label: string): void {
  if (!existsSync(path)) return
  const info = lstatSync(path)
  if (info.isSymbolicLink()) {
    throw new InfraError(`${label} 不能是 symlink: ${path}`)
  }
  if (!info.isDirectory()) {
    throw new InfraError(`${label} 不是目录: ${path}`)
  }
}

export interface TaskPaths {
  labDir: string
  tasksDir: string
  taskDir: string
}

/**
 * Create `.lab/tasks/<taskId>` without following symlinks. Artifacts contain
 * diffs and test output, so they must stay inside the supervised repository.
 */
export function prepareTaskDirectory(
  repoRoot: string,
  taskId: string,
): TaskPaths {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new InfraError(`非法 task ID: ${taskId}`)
  }

  const labDir = join(repoRoot, '.lab')
  const tasksDir = join(labDir, 'tasks')
  const taskDir = join(tasksDir, taskId)

  try {
    assertSafeDirectory(labDir, '.lab')
    mkdirSync(labDir, { recursive: true, mode: 0o700 })
    assertSafeDirectory(labDir, '.lab')

    assertSafeDirectory(tasksDir, '.lab/tasks')
    mkdirSync(tasksDir, { recursive: true, mode: 0o700 })
    assertSafeDirectory(tasksDir, '.lab/tasks')

    if (existsSync(taskDir)) {
      throw new InfraError(`任务目录已存在: ${taskDir}`)
    }
    mkdirSync(taskDir, { recursive: true, mode: 0o700 })
    assertSafeDirectory(taskDir, 'task 目录')
  } catch (error) {
    if (error instanceof InfraError) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new InfraError(`无法创建监督工件目录: ${message}`)
  }

  const realTasksDir = realpathSync(tasksDir)
  const realTaskDir = realpathSync(taskDir)
  if (!isPathInside(realTasksDir, realTaskDir) || realTaskDir === realTasksDir) {
    throw new InfraError(`任务目录逃逸出 .lab/tasks: ${taskDir}`)
  }

  chmodQuiet(labDir, 0o700)
  chmodQuiet(tasksDir, 0o700)
  chmodQuiet(taskDir, 0o700)

  const gitignore = join(tasksDir, '.gitignore')
  if (existsSync(gitignore)) {
    const info = lstatSync(gitignore)
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new InfraError(`.lab/tasks/.gitignore 不是普通文件: ${gitignore}`)
    }
  } else {
    writeFileSync(gitignore, '*\n', { encoding: 'utf8', mode: 0o600 })
  }
  chmodQuiet(gitignore, 0o600)

  return { labDir, tasksDir, taskDir }
}

export class ArtifactStore {
  readonly taskDir: string
  private readonly redact: Redactor

  constructor(taskDir: string, redact: Redactor) {
    this.taskDir = resolve(taskDir)
    this.redact = redact
  }

  pathFor(relativePath: string): string {
    if (!relativePath || relativePath.includes('\0')) {
      throw new InfraError('工件路径不能为空或包含 NUL')
    }
    const normalized = relativePath.replace(/\\/g, '/')
    if (isAbsolute(normalized) || normalized.startsWith('/')) {
      throw new InfraError(`工件路径必须是相对路径: ${relativePath}`)
    }
    const segments = normalized.split('/')
    for (const segment of segments) {
      if (!segment || segment === '.' || segment === '..' || segment.includes(':')) {
        throw new InfraError(`非法工件路径: ${relativePath}`)
      }
    }
    const absolute = join(this.taskDir, ...segments)
    if (!isPathInside(this.taskDir, absolute)) {
      throw new InfraError(`工件路径逃逸出任务目录: ${relativePath}`)
    }
    return absolute
  }

  writeText(relativePath: string, text: string): string {
    const path = this.pathFor(relativePath)
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, this.redact(text), { encoding: 'utf8', mode: 0o600 })
    chmodQuiet(dirname(path), 0o700)
    chmodQuiet(path, 0o600)
    return path
  }

  writeJson(relativePath: string, value: unknown): string {
    const redacted = redactDeep(value, this.redact)
    return this.writeText(
      relativePath,
      `${JSON.stringify(redacted, null, 2)}\n`,
    )
  }
}

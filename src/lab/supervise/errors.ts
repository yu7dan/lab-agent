export class SuperviseError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode: number) {
    super(message)
    this.name = new.target.name
    this.exitCode = exitCode
  }
}

/** Wrong flags, bad contract, dirty worktree, missing configuration. */
export class UsageError extends SuperviseError {
  constructor(message: string) {
    super(message, 2)
  }
}

/** Engine failure, parse failure, git snapshot failure. */
export class InfraError extends SuperviseError {
  constructor(message: string) {
    super(message, 3)
  }
}

export class EngineNotFoundError extends SuperviseError {
  constructor(message: string) {
    super(message, 127)
  }
}

export class VerdictError extends InfraError {
  constructor(message: string) {
    super(message)
  }
}

export class CancelledError extends SuperviseError {
  constructor(message = '已取消') {
    super(message, 130)
  }
}

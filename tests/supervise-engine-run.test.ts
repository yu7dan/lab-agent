import { describe, expect, test } from 'bun:test'
import { InfraError } from '../src/lab/supervise/errors.js'
import { createRedactor } from '../src/lab/supervise/evidence.js'
import {
  AUDITOR_DISALLOWED_TOOLS,
  buildAuditorArgs,
  buildSessionId,
  buildWriterArgs,
  parseEngineResult,
  runEngineCaptured,
} from '../src/lab/supervise/engine-run.js'
import { VERDICT_SCHEMA } from '../src/lab/supervise/verdict.js'
import type { EngineResult } from '../src/lab/supervise/types.js'

const bun = process.execPath

function resultValue(overrides: Partial<EngineResult> = {}): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    permission_denials: [],
    session_id: 'session-1',
    num_turns: 3,
    total_cost_usd: 0.02,
    ...overrides,
  }
}

describe('engine arguments', () => {
  test('writer args use a fresh headless session and explicit settings', () => {
    const args = buildWriterArgs({
      writerMode: 'bypass',
      maxTurns: 12,
      budgetUsd: 2,
      sessionId: 'session-id',
      settingsPath: 'C:/task/settings/writer.json',
      systemPromptPath: 'C:/task/prompts/writer.md',
    })
    expect(args).toContain('-p')
    expect(args).toContain('--output-format')
    expect(args[args.indexOf('--output-format') + 1]).toBe('json')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('bypassPermissions')
    expect(args[args.indexOf('--max-turns') + 1]).toBe('12')
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('2')
    expect(args).toContain('--no-session-persistence')
    expect(args[args.indexOf('--session-id') + 1]).toBe('session-id')
    expect(args[args.indexOf('--settings') + 1]).toBe(
      'C:/task/settings/writer.json',
    )
    expect(args).toContain('--append-system-prompt-file')
    expect(args).not.toContain('--bare')
    expect(args).not.toContain('--dangerously-skip-permissions')
  })

  test('writer args support acceptEdits and omit an absent budget', () => {
    const args = buildWriterArgs({
      writerMode: 'acceptEdits',
      maxTurns: 5,
      sessionId: 'session-id',
      settingsPath: 'settings.json',
      systemPromptPath: 'system.md',
    })
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
    expect(args).not.toContain('--max-budget-usd')
  })

  test('auditor args are read-only and schema-constrained', () => {
    const args = buildAuditorArgs({
      maxTurns: 20,
      budgetUsd: 1,
      sessionId: 'auditor-session',
      settingsPath: 'auditor-settings.json',
      systemPromptPath: 'auditor-system.md',
      model: 'audit-model',
    })
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk')
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob')
    expect(args).toContain('--strict-mcp-config')
    expect(args).toContain('--setting-sources=')
    expect(args[args.indexOf('--max-turns') + 1]).toBe('20')
    expect(args[args.indexOf('--model') + 1]).toBe('audit-model')
    expect(args).toContain('--json-schema')
    expect(args).toContain('--no-session-persistence')

    const disallowed = args[args.indexOf('--disallowedTools') + 1]!
    for (const tool of ['Write', 'Edit', 'Bash', 'PowerShell', 'Agent', 'WebFetch']) {
      expect(AUDITOR_DISALLOWED_TOOLS).toContain(tool)
      expect(disallowed.split(',')).toContain(tool)
    }

    const schema = JSON.parse(args[args.indexOf('--json-schema') + 1]!)
    expect(schema).toEqual(VERDICT_SCHEMA)
    expect(schema.required).toEqual(['verdict', 'summary', 'findings'])
    expect(schema.additionalProperties).toBe(false)
  })

  test('auditor args omit the model when it is not configured', () => {
    const args = buildAuditorArgs({
      maxTurns: 20,
      sessionId: 's',
      settingsPath: 's.json',
      systemPromptPath: 'p.md',
    })
    expect(args).not.toContain('--model')
  })

  test('session IDs are UUIDs', () => {
    const ids = new Set(Array.from({ length: 5 }, () => buildSessionId()))
    expect(ids.size).toBe(5)
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      )
    }
  })
})

describe('parseEngineResult', () => {
  test('parses a single result object and normalizes fields', () => {
    const value = resultValue({
      permission_denials: [
        { tool_name: 'Bash', tool_use_id: '1', tool_input: { command: 'x' } },
        'invalid',
      ] as unknown as EngineResult['permission_denials'],
      errors: ['one', 2] as unknown as string[],
    })
    const parsed = parseEngineResult(JSON.stringify(value))
    expect(parsed.type).toBe('result')
    expect(parsed.subtype).toBe('success')
    expect(parsed.is_error).toBe(false)
    expect(parsed.result).toBe('done')
    expect(parsed.session_id).toBe('session-1')
    expect(parsed.num_turns).toBe(3)
    expect(parsed.total_cost_usd).toBe(0.02)
    expect(parsed.permission_denials).toHaveLength(2)
    expect(parsed.permission_denials[0]!.tool_name).toBe('Bash')
    expect(parsed.errors).toEqual(['one'])
  })

  test('falls back to the last JSON line', () => {
    const parsed = parseEngineResult(
      `warning: something\n${JSON.stringify(resultValue())}\n`,
    )
    expect(parsed.subtype).toBe('success')
  })

  test('accepts the last object of an array', () => {
    const parsed = parseEngineResult(
      JSON.stringify([{ type: 'assistant' }, resultValue()]),
    )
    expect(parsed.subtype).toBe('success')
  })

  test('rejects malformed, empty, and non-result output', () => {
    expect(() => parseEngineResult('')).toThrow(InfraError)
    expect(() => parseEngineResult('not json')).toThrow(InfraError)
    expect(() => parseEngineResult('{"type":"assistant"}')).toThrow(InfraError)
    expect(() =>
      parseEngineResult(JSON.stringify({ type: 'result' })),
    ).toThrow(InfraError)
  })
})

describe('runEngineCaptured', () => {
  test('runs a fake engine and returns the parsed result', async () => {
    const script = `process.stdout.write(${JSON.stringify(
      JSON.stringify({
        ...resultValue(),
        structured_output: { verdict: 'accept', summary: 'ok', findings: [] },
      }),
    )})`
    const output = await runEngineCaptured({
      enginePath: bun,
      args: ['-e', script],
      prompt: 'ignored',
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 10_000,
    })
    expect(output.parsed.subtype).toBe('success')
    expect(output.parsed.structured_output).toEqual({
      verdict: 'accept',
      summary: 'ok',
      findings: [],
    })
  })

  test('turns an error result into an infrastructure error', async () => {
    const script = `process.stdout.write(${JSON.stringify(
      JSON.stringify(
        resultValue({
          subtype: 'error_during_execution',
          is_error: true,
          result: 'boom',
        }),
      ),
    )})`
    await expect(
      runEngineCaptured({
        enginePath: bun,
        args: ['-e', script],
        prompt: '',
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow('error_during_execution')
  })

  test('redacts forwarded stderr before the callback sees it', async () => {
    const secret = 'sk-super-secret-value'
    const script = `
      process.stderr.write(${JSON.stringify(`token=${secret}\n`)})
      process.stdout.write(${JSON.stringify(JSON.stringify(resultValue()))})
    `
    const chunks: string[] = []
    const output = await runEngineCaptured({
      enginePath: bun,
      args: ['-e', script],
      prompt: '',
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 10_000,
      redact: createRedactor([secret]),
      onStderr: (chunk) => chunks.push(chunk),
    })
    expect(output.parsed.subtype).toBe('success')
    expect(chunks.join('')).toContain('[REDACTED]')
    expect(chunks.join('')).not.toContain(secret)
  })
})

import { chmodSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json() as {
  name: string
  version: string
}

const args = process.argv.slice(2)
const compile = args.includes('--compile')
const dev = args.includes('--dev')

/** Optional Bun compile target, e.g. bun-darwin-arm64 / bun-windows-x64 / bun-linux-x64 */
function readBunTarget(): string {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--bun-target' && args[i + 1]) return args[i + 1]!
    if (arg.startsWith('--bun-target=')) return arg.slice('--bun-target='.length)
  }
  return 'bun'
}

function runCommand(cmd: string[]): string | null {
  const proc = Bun.spawnSync({
    cmd,
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (proc.exitCode !== 0) return null
  return new TextDecoder().decode(proc.stdout).trim() || null
}

function getDevVersion(baseVersion: string): string {
  const timestamp = new Date().toISOString()
  const date = timestamp.slice(0, 10).replaceAll('-', '')
  const time = timestamp.slice(11, 19).replaceAll(':', '')
  const sha = runCommand(['git', 'rev-parse', '--short=8', 'HEAD']) ?? 'unknown'
  return `${baseVersion}-dev.${date}.t${time}.sha${sha}`
}

const outfile = compile
  ? dev
    ? './dist/lab-dev'
    : './dist/lab'
  : dev
    ? './lab-dev'
    : './lab'
const version = dev ? getDevVersion(pkg.version) : pkg.version

const outDir = dirname(outfile)
if (outDir !== '.') {
  mkdirSync(outDir, { recursive: true })
}

const bunTarget = readBunTarget()
const cmd = [
  'bun',
  'build',
  './src/lab/cli.ts',
  '--compile',
  '--target',
  bunTarget,
  '--format',
  'esm',
  '--outfile',
  outfile,
  '--minify',
  ...(bunTarget === 'bun' ? ['--bytecode'] : []),
  '--packages',
  'bundle',
  '--conditions',
  'bun',
  '--define',
  `MACRO.VERSION=${JSON.stringify(version)}`,
]

const proc = Bun.spawnSync({
  cmd,
  cwd: process.cwd(),
  stdout: 'inherit',
  stderr: 'inherit',
})

if (proc.exitCode !== 0) {
  process.exit(proc.exitCode ?? 1)
}

const windowsOutfile = `${outfile}.exe`
const actualOutfile = existsSync(outfile)
  ? outfile
  : existsSync(windowsOutfile)
    ? windowsOutfile
    : outfile
if (existsSync(actualOutfile)) chmodSync(actualOutfile, 0o755)

console.log(`Built ${actualOutfile}`)

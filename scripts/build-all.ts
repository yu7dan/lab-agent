const args = process.argv.slice(2)
const scripts = ['./scripts/build-engine.ts', './scripts/build-cli.ts']

for (const script of scripts) {
  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', script, ...args],
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1)
}

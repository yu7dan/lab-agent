import { rmSync } from 'fs'

const targets = [
  'dist',
  'lab',
  'lab.exe',
  'lab-dev',
  'lab-dev.exe',
  'lab-engine',
  'lab-engine.exe',
  'lab-engine-dev',
  'lab-engine-dev.exe',
]

for (const target of targets) {
  rmSync(target, { recursive: true, force: true })
}

console.log('Cleaned build outputs.')

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const wrapper = readFileSync(new URL('../../start-rovai.cmd', import.meta.url), 'utf8')
const launcher = readFileSync(new URL('../start-rovai.ps1', import.meta.url), 'utf8')

test('Windows local launcher keeps the canonical isolated development path', () => {
  assert.match(wrapper, /%~dp0scripts\\start-rovai\.ps1/)
  assert.match(wrapper, /-ExecutionPolicy Bypass/)
  assert.match(wrapper, /"--check"/)
  assert.doesNotMatch(wrapper, /[^\x00-\x7F]/)

  assert.match(launcher, /Join-Path \$PSScriptRoot '\.\.'/)
  assert.match(launcher, /\[int\]\$nodeMajor -lt 24/)
  assert.match(launcher, /Resolve-RovaiCommand 'corepack\.cmd'/)
  assert.match(launcher, /\.codex\\packages\\standalone\\current\\bin\\codex\.exe/)
  assert.match(launcher, /\$env:ROVAI_CODEX_BIN = \$codexExecutable/)
  assert.match(launcher, /Invoke-RovaiPnpm 'install' '--frozen-lockfile'/)
  assert.match(launcher, /Invoke-RovaiPnpm 'dev'/)
  assert.doesNotMatch(launcher, /electron-vite dev/)
  assert.doesNotMatch(launcher, /[A-Z]:\\Users\\/i)
})

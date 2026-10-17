import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEED_MODULES, assertSeedOnly, buildClient } from '../scripts/build-client.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('客户端产物：单信封、只 require seed 表里的模块', async () => {
  const { output, required } = await buildClient({ log: false })
  assert.ok(output.startsWith('// Generated from src/client'), '产物缺少生成头')
  assert.equal(output.split('window.__ModuleLoader__.load').length - 1, 1)
  for (const id of required) assert.ok(SEED_MODULES.includes(id), `${id} 不在 seed 表内`)
  assert.ok(required.includes('react'), 'react 必须是 external（否则会打进两份 React）')
})

test('越界 require 会让构建失败，而不是等到运行时', () => {
  assert.throws(() => assertSeedOnly('require("left-pad")'), /越出 seed 表/)
  assert.throws(() => assertSeedOnly('const x = 1'), /应恰好出现 1 次/)
  assert.throws(() => assertSeedOnly('window.__ModuleLoader__.load({});\nwindow.__ModuleLoader__.load({})'), /应恰好出现 1 次/)
  assert.throws(() => assertSeedOnly('window.__ModuleLoader__.load({});\nrequire(name)'), /不是字符串字面量/)
})

test('仓根的 client.js 与源码同步（防止改了源码忘了重新构建）', async () => {
  const { output } = await buildClient({ log: false })
  const committed = readFileSync(join(ROOT, 'client.js'), 'utf8')
  assert.equal(committed, output)
})

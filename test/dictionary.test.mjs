import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { en, zh } from '../src/client/dictionary.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('中英词典的键集合一字不差', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('界面里用到的每个文案键都在词典里', () => {
  const source = readFileSync(join(ROOT, 'src', 'client', 'pills.jsx'), 'utf8')
  const used = new Set()
  // t('key') 与 t(cond ? 'a' : 'b')
  for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(match[1])
  for (const match of source.matchAll(/\bt\([^)]*?\?\s*'([^']+)'\s*:\s*'([^']+)'/g)) {
    used.add(match[1])
    used.add(match[2])
  }
  assert.ok(used.size > 10, `应扫到足够多的键，实际 ${used.size}`)
  const missing = [...used].filter((key) => zh[key] === undefined)
  assert.deepEqual(missing, [])
  const unused = Object.keys(zh).filter((key) => !used.has(key))
  assert.deepEqual(unused, [], '词典里有没被用到的键（要么删掉，要么是漏接了文案）')
})

test('文案里的占位符两边一致', () => {
  for (const key of Object.keys(zh)) {
    const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    assert.deepEqual(placeholders(zh[key]), placeholders(en[key]), `${key} 的占位符不一致`)
  }
})

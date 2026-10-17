import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatMoney, formatTokens, lookupPrice, normalizePriceTable, priceUsage } from '../src/shared/pricing.js'

/** 官方价目（元 / 百万 tokens），与 cordis.patch.yml 里的一致。 */
const table = normalizePriceTable({
  currency: 'CNY',
  models: {
    'deepseek-flash': {
      label: 'DeepSeek-V4.1-Flash',
      peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
      offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    },
    'deepseek-v4-pro': {
      label: 'DeepSeek-V4-Pro-0813',
      peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
      offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
    },
  },
})

test('峰值单价：百万 token 正好等于价目表上的数', () => {
  const peak = priceUsage({
    table,
    provider: 'deepseek-account',
    model: 'deepseek-flash',
    period: 'peak',
    usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })
  assert.equal(peak.priced, true)
  assert.equal(peak.nano, 2_000_000_000) // 2 元

  const output = priceUsage({
    table, provider: 'deepseek-account', model: 'deepseek-flash', period: 'peak',
    usage: { inputTokens: 0, outputTokens: 1_000_000 },
  })
  assert.equal(output.nano, 8_000_000_000)

  const hit = priceUsage({
    table, provider: 'deepseek-account', model: 'deepseek-flash', period: 'peak',
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 },
  })
  assert.equal(hit.nano, 40_000_000)
})

test('波谷单价正好是波峰的一半', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 }
  const peak = priceUsage({ table, provider: 'deepseek-account', model: 'deepseek-flash', period: 'peak', usage })
  const offPeak = priceUsage({ table, provider: 'deepseek-account', model: 'deepseek-flash', period: 'offPeak', usage })
  assert.equal(peak.nano, 2_000_000_000 + 8_000_000_000 + 40_000_000)
  assert.equal(offPeak.nano, (2_000_000_000 + 8_000_000_000 + 40_000_000) / 2)
})

test('四个桶各自留金额，加起来等于总额', () => {
  const result = priceUsage({
    table, provider: 'deepseek-account', model: 'deepseek-flash', period: 'peak',
    usage: { inputTokens: 146, outputTokens: 1272, cacheReadTokens: 519_296, cacheWriteTokens: 0 },
  })
  const sum = result.nanoByBucket.cacheHit + result.nanoByBucket.cacheMiss
    + result.nanoByBucket.cacheWrite + result.nanoByBucket.output
  assert.equal(sum, result.nano)
  assert.equal(result.nanoByBucket.cacheHit, 519_296 * 40)
  assert.equal(result.nanoByBucket.cacheMiss, 146 * 2 * 1000)
  assert.equal(result.nanoByBucket.output, 1272 * 8 * 1000)
  assert.equal(result.tokens, 146 + 1272 + 519_296)
})

test('cacheWrite 未单列时按 cacheMiss 价（不少算的那一侧）', () => {
  const withWrite = priceUsage({
    table, provider: 'deepseek-account', model: 'deepseek-flash', period: 'peak',
    usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 },
  })
  assert.equal(withWrite.nano, 2_000_000_000)
})

test('查价顺序：provider/model 优先于裸 model，裸 model 优先于 defaultModel', () => {
  const scoped = normalizePriceTable({
    currency: 'CNY',
    defaultModel: 'deepseek-flash',
    models: {
      'deepseek-flash': { peak: { cacheMiss: 2, output: 8 }, offPeak: { cacheMiss: 1, output: 4 } },
      'my-gateway/deepseek-flash': { peak: { cacheMiss: 20, output: 80 }, offPeak: { cacheMiss: 10, output: 40 } },
    },
  })
  assert.equal(lookupPrice(scoped, 'my-gateway', 'deepseek-flash').key, 'my-gateway/deepseek-flash')
  assert.equal(lookupPrice(scoped, 'deepseek-account', 'deepseek-flash').key, 'deepseek-flash')
  assert.equal(lookupPrice(scoped, 'something', 'unknown-model').key, 'deepseek-flash')
  assert.equal(lookupPrice(normalizePriceTable({ models: {} }), 'qwen', 'qwen3.8-max'), null)
})

test('未配单价的路由是未计价，不是 0 元', () => {
  const result = priceUsage({
    table, provider: 'qwen', model: 'qwen3.8-max', period: 'peak',
    usage: { inputTokens: 1000, outputTokens: 500 },
  })
  assert.equal(result.priced, false)
  assert.equal(result.nano, 0)
  assert.equal(result.tokens, 1500) // token 数是事实，照记
})

test('配置错误在构造时抛，不静默接受', () => {
  assert.throws(() => normalizePriceTable({ models: { x: { peak: { cacheMiss: 1 }, offPeak: { cacheMiss: 1, output: 1 } } } }), /必须给出 cacheMiss 与 output/)
  assert.throws(() => normalizePriceTable({ models: { x: { peak: { cacheMiss: -1, output: 1 }, offPeak: { cacheMiss: 1, output: 1 } } } }), /非负数字/)
  assert.throws(() => normalizePriceTable({ defaultModel: 'nope', models: {} }), /未定义的型号/)
})

test('金额与 token 的显示格式', () => {
  assert.equal(formatMoney(0, 'CNY'), '¥0.00')
  assert.equal(formatMoney(12_345_678_900, 'CNY'), '¥12.35')
  assert.equal(formatMoney(31_239_840, 'CNY'), '¥0.0312')
  assert.equal(formatMoney(146_000, 'CNY'), '¥0.000146')
  assert.equal(formatMoney(1_000_000_000, 'USD'), '$1.00')
  assert.equal(formatTokens(3_700_000), '3.7M')
  assert.equal(formatTokens(519_296), '519.3K')
  assert.equal(formatTokens(842), '842')
})

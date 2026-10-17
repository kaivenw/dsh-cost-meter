import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHARS_PER_TOKEN, estimateInFlightNano, partialChars } from '../src/client/estimate.js'

/** 与 cordis.patch.yml 一致的官方价目（元 / 百万 tokens）。 */
const pricing = {
  currency: 'CNY',
  defaultModel: null,
  models: {
    'deepseek-flash': {
      label: 'DeepSeek-V4.1-Flash',
      peak: { cacheHit: 0.04, cacheMiss: 2, cacheWrite: 2, output: 8 },
      offPeak: { cacheHit: 0.02, cacheMiss: 1, cacheWrite: 1, output: 4 },
    },
  },
}

test('流式字符数：文本、推理、工具调用参数都算，结构不认识就返回 0', () => {
  assert.equal(CHARS_PER_TOKEN, 4)
  assert.equal(partialChars(null), 0)
  assert.equal(partialChars({}), 0)
  assert.equal(partialChars({ blocks: 'nope' }), 0)
  assert.equal(partialChars({ blocks: [] }), 0)
  assert.equal(partialChars({ blocks: [{ kind: 'text', text: 'abc' }, { kind: 'reasoning', text: 'de' }] }), 5)
  assert.equal(partialChars({ blocks: [{ kind: 'tool-call', name: 'read', arguments: '{"a":1}' }] }), 11)
  assert.equal(partialChars({ blocks: [{ kind: 'image' }, null, 7] }), 0)
})

test('在飞估算：输出按 4 字符/token 折算，提示词用上一次调用的桶代理', () => {
  const nano = estimateInFlightNano({
    pricing,
    previousBuckets: { cacheHit: 334_976, cacheMiss: 1500, cacheWrite: 0 },
    chars: 4000,
    model: 'deepseek-flash',
    period: 'peak',
  })
  // 命中 334976×0.04×1000 + 未命中 1500×2×1000 + 输出 1000×8×1000
  assert.equal(nano, 13_399_040 + 3_000_000 + 8_000_000)
})

test('波谷估算走半价', () => {
  const peak = estimateInFlightNano({ pricing, previousBuckets: { cacheHit: 1000, cacheMiss: 0 }, chars: 400, model: 'deepseek-flash', period: 'peak' })
  const offPeak = estimateInFlightNano({ pricing, previousBuckets: { cacheHit: 1000, cacheMiss: 0 }, chars: 400, model: 'deepseek-flash', period: 'offPeak' })
  assert.equal(peak, 1000 * 0.04 * 1000 + 100 * 8 * 1000)
  assert.equal(offPeak, peak / 2)
})

test('估不出来就返回 0：没有字符、没有价目、型号未配价、配置不合法', () => {
  assert.equal(estimateInFlightNano({ pricing, previousBuckets: null, chars: 0, period: 'peak' }), 0)
  assert.equal(estimateInFlightNano({ pricing: undefined, previousBuckets: null, chars: 100, period: 'peak' }), 0)
  assert.equal(estimateInFlightNano({ pricing, previousBuckets: null, chars: 100, model: 'qwen3.8-max', period: 'peak' }), 0)
  assert.equal(estimateInFlightNano({ pricing: { models: { x: { peak: { cacheMiss: 1 }, offPeak: { cacheMiss: 1 } } } }, previousBuckets: null, chars: 100, period: 'peak' }), 0)
})

test('缺省型号回落到价目表的 defaultModel', () => {
  const withDefault = { ...pricing, defaultModel: 'deepseek-flash' }
  const nano = estimateInFlightNano({ pricing: withDefault, previousBuckets: { cacheHit: 0, cacheMiss: 0 }, chars: 400, period: 'peak' })
  assert.equal(nano, 100 * 8 * 1000)
})

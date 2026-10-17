import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCostProjection } from '../src/host/cost-fold.js'
import { normalizeSchedule } from '../src/shared/schedule.js'
import { normalizePriceTable } from '../src/shared/pricing.js'

/** 北京时间 → epoch 毫秒。 */
function beijing(text) {
  const matched = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text)
  assert.ok(matched, `测试用例时间写法：${text}`)
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]), Number(matched[4]) - 8, Number(matched[5]))
}

const projection = createCostProjection({
  schedule: normalizeSchedule({}),
  pricing: normalizePriceTable({
    currency: 'CNY',
    models: {
      'deepseek-flash': {
        label: 'DeepSeek-V4.1-Flash',
        peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
        offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
      },
    },
  }),
})

let seq = 0
function nextSeq() {
  seq += 1
  return seq
}

function message({ time, turn, step, usage, provider = 'deepseek-account', model = 'deepseek-flash' }) {
  return {
    type: 'assistant/message',
    seq: nextSeq(),
    time,
    data: {
      turn,
      step,
      usage,
      stream: [],
      message: { role: 'assistant', source: { kind: 'model', provider, model } },
    },
  }
}

/** 未知形状的事件也必须能安全穿过折叠：本项目对「日志里多了新类型」的默认姿态是不认它。 */
function unknownEvent() {
  return { type: 'something/new', seq: nextSeq(), time: Date.now(), data: {} }
}

/** 把一串事件折叠成最终状态（等价于注册表的驱动方式）。 */
function fold(events, initial = projection.init()) {
  return events.reduce((state, event) => projection.apply(state, event), initial)
}

test('初始状态与线值都过得去自己的 schema', () => {
  const initial = projection.init()
  assert.deepEqual(projection.stateSchema.parse(initial), initial)
  const view = projection.wire.view(initial)
  assert.deepEqual(projection.wire.viewSchema.parse(view), view)
})

test('按调用发生时刻的时段计价：同一次会话跨时段不会算错', () => {
  const peakTime = beijing('2026-10-16 10:00') // 周五高峰
  const offPeakTime = beijing('2026-10-16 20:00') // 周五晚，空闲
  const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  const state = fold([
    message({ time: peakTime, turn: 1, step: 1, usage }),
    message({ time: offPeakTime, turn: 1, step: 2, usage }),
  ])
  assert.equal(state.periods.peak.nano, 2_000_000_000)
  assert.equal(state.periods.offPeak.nano, 1_000_000_000)
  assert.equal(state.totals.nano, 3_000_000_000)
  assert.equal(state.totals.calls, 2)

  const view = projection.wire.view(state)
  assert.equal(view.totals.nano, 3_000_000_000)
  assert.equal(view.periods.peak.tokens, 1_000_000)
  assert.equal(view.periods.offPeak.tokens, 1_000_000)
  assert.deepEqual(projection.wire.viewSchema.parse(view), view)
})

test('同一步骤的后续样本替换前一个，不重复计费', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([
    message({ time, turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 10 } }),
    message({ time, turn: 1, step: 1, usage: { inputTokens: 500_000, outputTokens: 20_000 } }),
  ])
  assert.equal(state.totals.calls, 1)
  assert.equal(state.totals.buckets.cacheMiss, 500_000)
  assert.equal(state.totals.buckets.output, 20_000)
  assert.equal(state.totals.nano, 500_000 * 2 * 1000 + 20_000 * 8 * 1000)
})

test('重试是另一次计费：llm/retry-started 关掉替换槽后重新累加', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([
    message({ time, turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 100 } }),
    { type: 'llm/retry-started', seq: nextSeq(), time, data: { turn: 1, step: 1 } },
    message({ time, turn: 1, step: 1, usage: { inputTokens: 2000, outputTokens: 200 } }),
  ])
  assert.equal(state.totals.calls, 2)
  assert.equal(state.totals.buckets.cacheMiss, 3000)
  assert.equal(state.totals.buckets.output, 300)
})

test('重试但同一步骤没有新样本时不会重复计数', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([
    message({ time, turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 100 } }),
    { type: 'llm/retry-started', seq: nextSeq(), time, data: { turn: 1, step: 1 } },
    { type: 'llm/retry', seq: nextSeq(), time, data: { turn: 1, step: 1 } },
  ])
  assert.equal(state.totals.calls, 1)
  assert.equal(state.totals.nano, 1000 * 2 * 1000 + 100 * 8 * 1000)
})

test('只在流里有 usage 的调用也能计价（assistant/attempt）', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([
    { type: 'request/context', seq: nextSeq(), time, data: { provider: 'deepseek-account', model: 'deepseek-flash', contextWindow: 1_000_000 } },
    {
      type: 'assistant/attempt',
      seq: nextSeq(),
      time,
      data: {
        turn: 1,
        step: 1,
        stream: [
          { type: 'chunk', time, chunk: { type: 'text-delta', text: 'hi' } },
          { type: 'chunk', time, chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 50 } } },
        ],
      },
    },
  ])
  assert.equal(state.totals.calls, 1)
  assert.equal(state.totals.nano, 1000 * 2 * 1000 + 50 * 8 * 1000)
  assert.equal(state.last.priced, true)
})

test('消息没带 source 时用最近一次 request/context 的路由', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([
    { type: 'request/context', seq: nextSeq(), time, data: { provider: 'deepseek-account', model: 'deepseek-flash' } },
    {
      type: 'assistant/message',
      seq: nextSeq(),
      time,
      data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 0 }, stream: [], message: { role: 'assistant' } },
    },
  ])
  assert.equal(state.last.key, 'deepseek-flash')
  assert.equal(state.totals.nano, 1000 * 2 * 1000)
})

test('未计价路由单独计数，绝不混进金额', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([
    message({ time, turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 100 }, provider: 'qwen', model: 'qwen3.8-max' }),
    message({ time, turn: 1, step: 2, usage: { inputTokens: 1000, outputTokens: 0 } }),
  ])
  assert.equal(state.totals.unpricedCalls, 1)
  assert.equal(state.totals.unpricedTokens, 1100)
  assert.equal(state.totals.nano, 1000 * 2 * 1000)
  assert.equal(state.models['qwen/qwen3.8-max'].priced, false)
  assert.equal(state.models['qwen/qwen3.8-max'].nano, 0)
})

test('无关事件返回同一个状态引用（引用不变 = 下游零工作）', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([message({ time, turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 0 } })])
  assert.equal(projection.apply(state, unknownEvent()), state)
  assert.equal(projection.apply(state, { type: 'turn/start', seq: nextSeq(), time, data: { turn: 2 } }), state)
})

test('重复的相同样本不制造新状态', () => {
  const time = beijing('2026-10-16 10:00')
  const event = message({ time, turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 0 } })
  const once = projection.apply(projection.init(), event)
  const twice = projection.apply(once, { ...event, seq: event.seq + 1 })
  assert.equal(twice, once)
})

test('逐轮累计与总额自洽', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([
    message({ time, turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 100 } }),
    message({ time, turn: 2, step: 1, usage: { inputTokens: 2000, outputTokens: 200 } }),
    message({ time, turn: 2, step: 2, usage: { inputTokens: 4000, outputTokens: 400 } }),
  ])
  const perTurn = state.turns.reduce((sum, entry) => sum + entry.nano, 0)
  assert.equal(perTurn, state.totals.nano)
  assert.deepEqual(state.turns.map((entry) => entry.turn), [1, 2])
  assert.equal(state.turns[1].calls, 2)
  assert.equal(state.turns[1].nano, 2000 * 2 * 1000 + 200 * 8 * 1000 + 4000 * 2 * 1000 + 400 * 8 * 1000)
})

test('四个桶的金额加起来等于总额', () => {
  const time = beijing('2026-10-16 10:00')
  const state = fold([
    message({ time, turn: 1, step: 1, usage: { inputTokens: 146, outputTokens: 1272, cacheReadTokens: 519_296, cacheWriteTokens: 7 } }),
  ])
  const sum = state.totals.nanoByBucket.cacheHit + state.totals.nanoByBucket.cacheMiss
    + state.totals.nanoByBucket.cacheWrite + state.totals.nanoByBucket.output
  assert.equal(sum, state.totals.nano)
  assert.equal(state.totals.buckets.cacheWrite, 7)
})

test('stateSchema 拒绝被改坏的检查点行', () => {
  const state = projection.init()
  assert.throws(() => projection.stateSchema.parse({ ...state, totals: { ...state.totals, nano: -1 } }), /非负安全整数/)
  assert.throws(() => projection.stateSchema.parse({ ...state, extra: 1 }), /未声明字段/)
  assert.throws(() => projection.stateSchema.parse({ ...state, schema: 2 }), /应为 1/)
})

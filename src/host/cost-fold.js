/**
 * `costMeter` 会话投影：把持久日志里的每次计费用量按**发生时刻的时段**折算成金额。
 *
 * 为什么必须折叠在宿主侧、按事件时间计费：
 *   `tokenUsage` 投影只有四个 token 桶的会话总量，没有时间戳。用「当前时段」的单价
 *   去乘整个会话的总量，跨过一次时段切换就会便宜一半或贵一倍——那个数对不上账单。
 *   日志里每个事件都带 `time`，`request/context` 记路由，`assistant/message` 带
 *   `usage`，所以按调用逐笔计费是能做到精确的，就不该退而求其次。
 *
 * 与 `dsh-token-meter` 的 `tokenUsage` 保持同一套替换语义：
 *   - 同一步骤里后到的样本**替换**先到的（流式中间样本 → 最终样本）；
 *   - `llm/retry-started` 关掉替换槽，让重试的那次用量重新累加（重试是另一次计费）。
 * 这样两个投影对「几次调用、多少 token」的口径一致，金额和 token 数不会互相打架。
 *
 * 金额一律是整数纳元（见 shared/pricing.js）。四个 token 桶各自留一份纳元，
 * 是为了让界面能给出「这块 token 花了多少钱」，而不只是总额。
 */

import { periodAt } from '../shared/schedule.js'
import { priceUsage, tokensOf } from '../shared/pricing.js'
import { array, bool, int, literal, nullable, num, object, record, str } from '../shared/schema.js'

/** 投影键。与官方键（`tokenUsage`/`sessionStats`…）不重名。 */
export const PROJECTION_KEY = 'costMeter'

/** 状态形状版本。状态字段或折叠语义变化时必须递增，否则检查点缓存会喂回旧形状。 */
export const STATE_VERSION = 1

/** 逐轮明细只保留最近这么多轮：够界面显示「本轮/最近几轮」，又不会让状态无限长。 */
const MAX_TURNS = 50

const BUCKET_KEYS = ['cacheHit', 'cacheMiss', 'cacheWrite', 'output']

function zeroBuckets() {
  return { cacheMiss: 0, cacheHit: 0, cacheWrite: 0, output: 0 }
}

function periodSchema() {
  return {
    parse: (value, path = '') => {
      if (value !== 'peak' && value !== 'offPeak') {
        throw new Error(`cost-meter schema: ${path} 应为 peak/offPeak（实际 ${JSON.stringify(value)}）`)
      }
      return value
    },
  }
}

const bucketsSchema = () => object({ cacheMiss: int(), cacheHit: int(), cacheWrite: int(), output: int() })
const groupSchema = () => object({ nano: int(), nanoByBucket: bucketsSchema(), calls: int(), buckets: bucketsSchema() })
/** 线值里的分组比状态多一个派生的 `tokens`。 */
const groupSchemaWithTokens = () => object({
  nano: int(),
  nanoByBucket: bucketsSchema(),
  calls: int(),
  buckets: bucketsSchema(),
  tokens: int(),
})

const stateSchema = object({
  schema: literal(1),
  currency: str(),
  route: nullable(object({ provider: str(), model: str() })),
  totals: object({
    nano: int(),
    nanoByBucket: bucketsSchema(),
    calls: int(),
    buckets: bucketsSchema(),
    unpricedCalls: int(),
    unpricedTokens: int(),
  }),
  periods: object({ peak: groupSchema(), offPeak: groupSchema() }),
  models: record(object({
    label: str(),
    priced: bool(),
    nano: int(),
    nanoByBucket: bucketsSchema(),
    calls: int(),
    buckets: bucketsSchema(),
  })),
  turns: array(object({ turn: int(), nano: int(), calls: int(), buckets: bucketsSchema() })),
  last: nullable(object({
    turn: int(),
    step: int(),
    period: periodSchema(),
    key: str(),
    priced: bool(),
    nano: int(),
    nanoByBucket: bucketsSchema(),
    buckets: bucketsSchema(),
  })),
})

const viewSchema = object({
  currency: str(),
  totals: object({
    nano: int(),
    nanoByBucket: bucketsSchema(),
    calls: int(),
    buckets: bucketsSchema(),
    unpricedCalls: int(),
    unpricedTokens: int(),
    tokens: int(),
  }),
  periods: object({
    peak: groupSchemaWithTokens(),
    offPeak: groupSchemaWithTokens(),
  }),
  models: array(object({
    key: str(),
    label: str(),
    priced: bool(),
    nano: int(),
    nanoByBucket: bucketsSchema(),
    calls: int(),
    tokens: int(),
    buckets: bucketsSchema(),
  })),
  turns: array(object({ turn: int(), nano: int(), calls: int(), tokens: int() })),
  last: nullable(object({
    turn: int(),
    step: int(),
    period: periodSchema(),
    key: str(),
    priced: bool(),
    nano: int(),
    nanoByBucket: bucketsSchema(),
    buckets: bucketsSchema(),
    tokens: int(),
  })),
  pricing: object({
    currency: str(),
    defaultModel: nullable(str()),
    models: record(object({
      label: str(),
      peak: object({ cacheHit: num(), cacheMiss: num(), cacheWrite: num(), output: num() }),
      offPeak: object({ cacheHit: num(), cacheMiss: num(), cacheWrite: num(), output: num() }),
    })),
  }),
  schedule: object({
    offsetMinutes: num(),
    windows: array(array(num())),
    holidays: array(str()),
  }),
  diagnostics: bool(),
})

/** 一次调用的用量样本；`assistant/message` 优先用落库的 usage，否则回落到流里的最后一个 usage 分片。 */
function usageOf(event) {
  if (event.type === 'assistant/message' && event.data?.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  const stream = event.data?.stream
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const chunk = stream[index]?.chunk
    if (chunk?.type === 'usage' && chunk.usage !== undefined) return chunk.usage
  }
  return undefined
}

/** 本次调用实际走的路由：消息自带 source 最准，其次用最近一次 `request/context`。 */
function routeOf(event, state) {
  const source = event.data?.message?.source
  if (source !== undefined && typeof source.provider === 'string' && typeof source.model === 'string'
    && source.provider !== '' && source.model !== '') {
    return { provider: source.provider, model: source.model }
  }
  return state.route
}

function addBuckets(target, delta) {
  return {
    cacheMiss: target.cacheMiss + delta.cacheMiss,
    cacheHit: target.cacheHit + delta.cacheHit,
    cacheWrite: target.cacheWrite + delta.cacheWrite,
    output: target.output + delta.output,
  }
}

function scaleBuckets(buckets, sign) {
  return {
    cacheMiss: sign * buckets.cacheMiss,
    cacheHit: sign * buckets.cacheHit,
    cacheWrite: sign * buckets.cacheWrite,
    output: sign * buckets.output,
  }
}

/** 把一份贡献并入一个聚合组（贡献的金额已带符号）。 */
function mergeGroup(group, contribution, sign) {
  return {
    nano: group.nano + contribution.nano,
    nanoByBucket: addBuckets(group.nanoByBucket, contribution.nanoByBucket),
    calls: group.calls + sign,
    buckets: addBuckets(group.buckets, contribution.buckets),
  }
}

function emptyGroup() {
  return { nano: 0, nanoByBucket: zeroBuckets(), calls: 0, buckets: zeroBuckets() }
}

function sameContribution(left, right) {
  if (left.turn !== right.turn || left.step !== right.step || left.period !== right.period) return false
  if (left.key !== right.key || left.priced !== right.priced || left.nano !== right.nano) return false
  return BUCKET_KEYS.every((key) => left.buckets[key] === right.buckets[key] && left.nanoByBucket[key] === right.nanoByBucket[key])
}

/** 把一轮的累计值加上/减去一份贡献，返回新的 `turns` 数组（长度有上限）。 */
function foldTurns(turns, contribution, sign) {
  const index = turns.findIndex((entry) => entry.turn === contribution.turn)
  if (index === -1) {
    if (sign < 0) return turns
    const next = [...turns, {
      turn: contribution.turn,
      nano: contribution.nano,
      calls: 1,
      buckets: contribution.buckets,
    }]
    return next.length > MAX_TURNS ? next.slice(next.length - MAX_TURNS) : next
  }
  const entry = turns[index]
  const next = [...turns]
  next[index] = {
    turn: entry.turn,
    nano: entry.nano + sign * contribution.nano,
    calls: entry.calls + sign,
    buckets: addBuckets(entry.buckets, scaleBuckets(contribution.buckets, sign)),
  }
  return next
}

/** 把一份贡献（sign = 1）或它的负数（sign = -1）并入全部聚合。 */
function mergeContribution(state, contribution, sign) {
  const signed = {
    ...contribution,
    nano: sign * contribution.nano,
    nanoByBucket: scaleBuckets(contribution.nanoByBucket, sign),
    buckets: scaleBuckets(contribution.buckets, sign),
  }
  const tokens = tokensOf(contribution.buckets)
  const previousModel = state.models[contribution.key] ?? {
    label: contribution.label ?? contribution.key,
    priced: contribution.priced,
    nano: 0,
    nanoByBucket: zeroBuckets(),
    calls: 0,
    buckets: zeroBuckets(),
  }
  return {
    ...state,
    totals: {
      nano: state.totals.nano + signed.nano,
      nanoByBucket: addBuckets(state.totals.nanoByBucket, signed.nanoByBucket),
      calls: state.totals.calls + sign,
      buckets: addBuckets(state.totals.buckets, signed.buckets),
      unpricedCalls: state.totals.unpricedCalls + (contribution.priced ? 0 : sign),
      unpricedTokens: state.totals.unpricedTokens + (contribution.priced ? 0 : sign * tokens),
    },
    periods: {
      ...state.periods,
      [contribution.period]: mergeGroup(state.periods[contribution.period], signed, sign),
    },
    models: {
      ...state.models,
      [contribution.key]: {
        label: contribution.label ?? previousModel.label,
        priced: contribution.priced,
        nano: previousModel.nano + signed.nano,
        nanoByBucket: addBuckets(previousModel.nanoByBucket, signed.nanoByBucket),
        calls: previousModel.calls + sign,
        buckets: addBuckets(previousModel.buckets, signed.buckets),
      },
    },
    turns: foldTurns(state.turns, contribution, sign),
  }
}

/**
 * 建立 `costMeter` 投影定义。
 * @param args.schedule - {@link normalizeSchedule} 的结果。
 * @param args.pricing - {@link normalizePriceTable} 的结果。
 * @returns 可直接交给 `ctx.sessionProjections.register()` 的定义。
 */
export function createCostProjection({ schedule, pricing, diagnostics = false }) {
  // 视图里这两块来自配置、与折叠状态无关：只建一次，保持引用稳定。
  const pricingView = {
    currency: pricing.currency,
    defaultModel: pricing.defaultKey,
    models: pricing.models,
  }
  const scheduleView = {
    offsetMinutes: schedule.offsetMinutes,
    windows: schedule.windows,
    holidays: schedule.holidayList,
  }
  // 诊断开关走线值传给客户端：默认 false，只有 profile 里显式打开才会上报。
  const diagnosticsView = diagnostics === true

  return {
    key: PROJECTION_KEY,
    stateVersion: STATE_VERSION,
    stateSchema,

    init: () => ({
      schema: 1,
      currency: pricing.currency,
      route: null,
      totals: { nano: 0, nanoByBucket: zeroBuckets(), calls: 0, buckets: zeroBuckets(), unpricedCalls: 0, unpricedTokens: 0 },
      periods: { peak: emptyGroup(), offPeak: emptyGroup() },
      models: {},
      turns: [],
      last: null,
    }),

    /**
     * 折叠一个已提交事件。无关事件返回**同一个引用**——注册表按引用判断是否有变化，
     * 每次都新建对象会让客户端每条事件都重渲染一次。
     */
    apply: (state, event) => {
      if (event.type === 'request/context') {
        const provider = event.data?.provider
        const model = event.data?.model
        if (typeof provider !== 'string' || typeof model !== 'string') return state
        if (state.route !== null && state.route.provider === provider && state.route.model === model) return state
        return { ...state, route: { provider, model } }
      }

      if (event.type === 'llm/retry-started') {
        const turn = event.data?.turn
        const step = event.data?.step
        if (state.last === null || state.last.turn !== turn || state.last.step !== step) return state
        return { ...state, last: null }
      }

      if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
      const usage = usageOf(event)
      if (usage === undefined) return state
      const turn = event.data?.turn
      const step = event.data?.step
      if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(step)) return state

      const route = routeOf(event, state)
      const period = periodAt(event.time, schedule)
      const priced = priceUsage({
        table: pricing,
        provider: route?.provider,
        model: route?.model,
        period,
        usage,
      })
      const contribution = {
        turn,
        step,
        period,
        key: priced.key ?? (route === null ? 'unknown/unknown' : `${route.provider}/${route.model}`),
        label: priced.label,
        priced: priced.priced,
        nano: priced.nano,
        nanoByBucket: priced.nanoByBucket,
        buckets: priced.buckets,
      }

      // 同一步骤的旧样本要**扣掉**再加新的，否则流式中间样本会被重复计费。
      const replaced = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null
      if (replaced !== null && sameContribution(replaced, contribution)) return state

      let next = state
      if (replaced !== null) next = mergeContribution(next, replaced, -1)
      next = mergeContribution(next, contribution, 1)
      return {
        ...next,
        last: {
          turn,
          step,
          period,
          key: contribution.key,
          priced: contribution.priced,
          nano: contribution.nano,
          nanoByBucket: contribution.nanoByBucket,
          buckets: contribution.buckets,
        },
      }
    },

    wire: {
      viewSchema,
      view: (state) => ({
        currency: state.currency,
        totals: {
          nano: state.totals.nano,
          nanoByBucket: state.totals.nanoByBucket,
          calls: state.totals.calls,
          buckets: state.totals.buckets,
          unpricedCalls: state.totals.unpricedCalls,
          unpricedTokens: state.totals.unpricedTokens,
          tokens: tokensOf(state.totals.buckets),
        },
        periods: {
          peak: { ...state.periods.peak, tokens: tokensOf(state.periods.peak.buckets) },
          offPeak: { ...state.periods.offPeak, tokens: tokensOf(state.periods.offPeak.buckets) },
        },
        models: Object.entries(state.models).map(([key, entry]) => ({
          key,
          label: entry.label,
          priced: entry.priced,
          nano: entry.nano,
          nanoByBucket: entry.nanoByBucket,
          calls: entry.calls,
          tokens: tokensOf(entry.buckets),
          buckets: entry.buckets,
        })),
        turns: state.turns.map((entry) => ({
          turn: entry.turn,
          nano: entry.nano,
          calls: entry.calls,
          tokens: tokensOf(entry.buckets),
        })),
        last: state.last === null ? null : {
          turn: state.last.turn,
          step: state.last.step,
          period: state.last.period,
          key: state.last.key,
          priced: state.last.priced,
          nano: state.last.nano,
          nanoByBucket: state.last.nanoByBucket,
          buckets: state.last.buckets,
          tokens: tokensOf(state.last.buckets),
        },
        pricing: pricingView,
        schedule: scheduleView,
        diagnostics: diagnosticsView,
      }),
    },
  }
}

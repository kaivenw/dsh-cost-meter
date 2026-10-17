/**
 * 单价表与计费算术。
 *
 * 单价单位固定为「元 / 百万 tokens」（USD 表同理，只是货币换成 USD），
 * 与官方定价页一致，避免在配置里写「每 token 多少钱」这种要数零的写法。
 *
 * 金额一律用**整数纳元**（1 元 = 1e9 纳元）累加：
 *   nano = tokens × 单价 × 1000      （因为 单价/1e6 元每 token，×1e9 纳元每元 = ×1000）
 * 单价写成最多 3 位小数时这个乘法是精确的，跨调用累加也不掉精度——
 * 用浮点累加几万次会把「对得上账单」这件事变成「大概对得上」。
 */

/** 1 个货币单位 = 10^9 纳单位。 */
export const NANO_PER_UNIT = 1_000_000_000

const RATE_FIELDS = ['cacheHit', 'cacheMiss', 'cacheWrite', 'output']

/** 货币符号。未知货币退回代码本身，不猜符号。 */
export function currencySymbol(currency) {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

function readRates(raw, where) {
  if (raw === null || typeof raw !== 'object') throw new Error(`${where} 不是对象`)
  const rates = {}
  for (const field of RATE_FIELDS) {
    const value = raw[field]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${where}.${field} 不是非负数字：${JSON.stringify(value)}`)
    }
    rates[field] = value
  }
  if (rates.cacheMiss === undefined || rates.output === undefined) {
    throw new Error(`${where} 必须给出 cacheMiss 与 output 单价`)
  }
  if (rates.cacheHit === undefined) rates.cacheHit = rates.cacheMiss
  // 缓存写入价官方价目没有单列（DeepSeek 不报 cache write）。缺省按缓存未命中价，
  // 也就是「不因为缺配置而少算钱」的那一侧。
  if (rates.cacheWrite === undefined) rates.cacheWrite = rates.cacheMiss
  return rates
}

/**
 * 归一化单价表配置。
 * @param input - 插件配置里的 `pricing` 块。
 * @returns `{ currency, models: {key: {label, peak, offPeak}}, defaultKey }`。
 */
export function normalizePriceTable(input) {
  const source = input ?? {}
  const currency = typeof source.currency === 'string' && source.currency !== '' ? source.currency : 'CNY'
  const rawModels = source.models ?? {}
  if (rawModels === null || typeof rawModels !== 'object') throw new Error('pricing.models 不是对象')
  const models = {}
  for (const [key, entry] of Object.entries(rawModels)) {
    if (entry === null || typeof entry !== 'object') throw new Error(`pricing.models[${key}] 不是对象`)
    models[key] = {
      label: typeof entry.label === 'string' && entry.label !== '' ? entry.label : key,
      peak: readRates(entry.peak, `pricing.models[${key}].peak`),
      offPeak: readRates(entry.offPeak, `pricing.models[${key}].offPeak`),
    }
  }
  const defaultKey = typeof source.defaultModel === 'string' && source.defaultModel !== '' ? source.defaultModel : null
  if (defaultKey !== null && models[defaultKey] === undefined) {
    throw new Error(`pricing.defaultModel 指向未定义的型号：${defaultKey}`)
  }
  return { currency, models, defaultKey }
}

/**
 * 按 `provider/model` → `model` → 配置的兜底型号 的顺序查单价。
 *
 * 两级键是刻意的：同一张价目同时适用于 `deepseek-official` 与 `deepseek-account`
 * 两条路由（官方与账号走同一个价），写成一条就够；要按路由区别定价时，
 * 配上 `provider/model` 形状的键即可覆盖。
 *
 * @returns `{ key, label, rates }`，查不到返回 null（未计价，而不是按 0 计价）。
 */
export function lookupPrice(table, provider, model) {
  const candidates = []
  if (typeof provider === 'string' && provider !== '' && typeof model === 'string' && model !== '') {
    candidates.push(`${provider}/${model}`)
  }
  if (typeof model === 'string' && model !== '') candidates.push(model)
  if (table.defaultKey !== null) candidates.push(table.defaultKey)
  for (const candidate of candidates) {
    const entry = table.models[candidate]
    if (entry !== undefined) return { key: candidate, label: entry.label, rates: entry }
  }
  return null
}

/** 用量桶归一化：缺字段按 0，不臆造。 */
export function bucketsOf(usage) {
  return {
    cacheMiss: Math.max(0, Math.trunc(usage?.inputTokens ?? 0)),
    cacheHit: Math.max(0, Math.trunc(usage?.cacheReadTokens ?? 0)),
    cacheWrite: Math.max(0, Math.trunc(usage?.cacheWriteTokens ?? 0)),
    output: Math.max(0, Math.trunc(usage?.outputTokens ?? 0)),
  }
}

/** 一次调用的总 token（四个桶之和）。 */
export function tokensOf(buckets) {
  return buckets.cacheMiss + buckets.cacheHit + buckets.cacheWrite + buckets.output
}

/**
 * 为一次调用计价。
 * @param args.table - {@link normalizePriceTable} 的结果。
 * @param args.provider - 路由提供方，可缺省。
 * @param args.model - 路由型号，可缺省。
 * @param args.period - `'peak'` 或 `'offPeak'`。
 * @param args.usage - 会话日志里的 usage（`inputTokens` 等字段）。
 * @returns `{ priced, key, label, nano, nanoByBucket, buckets, tokens }`；未计价时 `nano` 为 0、`priced` 为 false。
 */
export function priceUsage({ table, provider, model, period, usage }) {
  const buckets = bucketsOf(usage)
  const tokens = tokensOf(buckets)
  const found = lookupPrice(table, provider, model)
  if (found === null || tokens === 0) {
    return {
      priced: false,
      key: found === null ? null : found.key,
      label: found === null ? null : found.label,
      nano: 0,
      nanoByBucket: { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0 },
      buckets,
      tokens,
    }
  }
  const rates = period === 'peak' ? found.rates.peak : found.rates.offPeak
  // 逐桶取整再相加：每个桶的乘法都是精确整数，误差不会被相加放大。
  const nanoByBucket = {
    cacheHit: Math.round(buckets.cacheHit * rates.cacheHit * 1000),
    cacheMiss: Math.round(buckets.cacheMiss * rates.cacheMiss * 1000),
    cacheWrite: Math.round(buckets.cacheWrite * rates.cacheWrite * 1000),
    output: Math.round(buckets.output * rates.output * 1000),
  }
  const nano = nanoByBucket.cacheHit + nanoByBucket.cacheMiss + nanoByBucket.cacheWrite + nanoByBucket.output
  return { priced: true, key: found.key, label: found.label, nano, nanoByBucket, buckets, tokens }
}

/**
 * 金额显示。小额给到有效位（一次调用的花费常在 1e-2～1e-4 量级），大额给到分。
 * @param nano - 整数纳元。
 * @param currency - 货币代码。
 * @returns 例如 `¥12.35`、`¥0.0312`、`¥0.000146`。
 */
export function formatMoney(nano, currency = 'CNY') {
  const symbol = currencySymbol(currency)
  const negative = nano < 0
  const sign = negative ? '-' : ''
  const value = Math.abs(nano) / NANO_PER_UNIT
  if (value === 0) return `${sign}${symbol}0.00`
  if (value < 0.01) {
    const text = trimZeros(value.toFixed(6))
    return text === '0' ? `${sign}${symbol}<0.000001` : `${sign}${symbol}${text}`
  }
  if (value < 1) return `${sign}${symbol}${trimZeros(value.toFixed(4))}`
  if (value < 1000) return `${sign}${symbol}${value.toFixed(2)}`
  return `${sign}${symbol}${value.toFixed(0)}`
}

function trimZeros(text) {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/**
 * token 数的紧凑显示：3.7M / 12.3K / 842。
 * @param count - token 数。
 */
export function formatTokens(count) {
  const value = Math.max(0, Math.trunc(count))
  if (value >= 1_000_000_000) return `${trimZeros((value / 1_000_000_000).toFixed(1))}B`
  if (value >= 1_000_000) return `${trimZeros((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${trimZeros((value / 1_000).toFixed(1))}K`
  return String(value)
}

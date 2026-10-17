/**
 * 在飞调用的实时金额估算（纯函数，便于单测）。
 *
 * 提供方要到流结束才在末尾的 usage 分片里报 token 数，所以「本轮实时消耗」这件事
 * 只能估：已吐出的字符数 ÷ 4（与 `dsh-token-meter` 的固定启发式同一密度）当作
 * 输出 token，提示词一侧用**上一次调用**的桶作为代理——同一个 agent 循环里相邻请求
 * 的提示词几乎相同，这正是缓存命中率能到 99% 的原因。
 *
 * 估算值在界面上带 `≈`：它不是账单数字，调用一落地就被投影里的精确值替换。
 */

import { normalizePriceTable, priceUsage } from '../shared/pricing.js'

/** 字符→token 折算密度，与 token meter 的 `CHARS_PER_TOKEN` 一致。 */
export const CHARS_PER_TOKEN = 4

/**
 * 正在流式输出的字符数（文本 + 推理 + 工具调用参数）。
 * @param partial - 聊天目标的 `legacy.partial`；没有在飞调用时是 null。
 * @returns 字符数；结构不认识时返回 0（宁可不估，也不猜）。
 */
export function partialChars(partial) {
  const blocks = partial?.blocks
  if (!Array.isArray(blocks)) return 0
  let chars = 0
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    if ((block.kind === 'text' || block.kind === 'reasoning') && typeof block.text === 'string') {
      chars += block.text.length
    } else if (block.kind === 'tool-call') {
      if (typeof block.name === 'string') chars += block.name.length
      if (typeof block.arguments === 'string') chars += block.arguments.length
    }
  }
  return chars
}

/**
 * 估算在飞那一次调用的金额。
 * @param args.pricing - 投影线值里的 `pricing` 块（`{currency, defaultModel, models}`）。
 * @param args.previousBuckets - 上一次已结算调用的 token 桶（提示词代理），可为空。
 * @param args.chars - 已流式输出的字符数。
 * @param args.model - 路由型号（或价目表键），缺省用价目表的 defaultModel。
 * @param args.period - 当前时段 `'peak'` / `'offPeak'`。
 * @returns 纳元；估不出来（未配单价、无字符、配置不合法）返回 0。
 */
export function estimateInFlightNano({ pricing, previousBuckets, chars, model, period }) {
  if (!(chars > 0) || pricing === undefined || pricing === null) return 0
  let table
  try {
    table = normalizePriceTable(pricing)
  } catch {
    return 0
  }
  const priced = priceUsage({
    table,
    model: model ?? pricing.defaultModel ?? undefined,
    period: period ?? 'offPeak',
    usage: {
      inputTokens: previousBuckets?.cacheMiss ?? 0,
      cacheReadTokens: previousBuckets?.cacheHit ?? 0,
      cacheWriteTokens: previousBuckets?.cacheWrite ?? 0,
      outputTokens: Math.ceil(chars / CHARS_PER_TOKEN),
    },
  })
  return priced.priced ? priced.nano : 0
}

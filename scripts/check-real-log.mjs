/**
 * 拿**真实会话日志**核一遍账：读 profile 的 cordis.patch.yml 取单价与时段，
 * 按投影的同一套折叠逻辑把整份日志折出金额，打印分项。
 *
 * 用途是校验，不是运行时：它能回答「这个插件算出来的数，跟日志里的 token 对不对得上」。
 * 独立的第二通道是 scripts/check-real-log.py——那份用 Python 从零写一遍同样的规则，
 * 两份结果必须一致；只跑一边不算验过。
 *
 * 用法：
 *   node scripts/check-real-log.mjs <session.v4.jsonl[.zstd]> [--json]
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { createCostProjection } from '../src/host/cost-fold.js'
import { normalizeSchedule } from '../src/shared/schedule.js'
import { formatMoney, formatTokens, normalizePriceTable, tokensOf } from '../src/shared/pricing.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 从本包的 cordis.patch.yml 取插件 config——跑着的插件读的就是这一份。 */
export function readPluginConfig(path = join(ROOT, 'cordis.patch.yml')) {
  const parsed = load(readFileSync(path, 'utf8'))
  const entry = parsed?.[0]?.insert?.find((item) => item?.id === 'dsh-cost-meter')
  if (entry === undefined) throw new Error(`${path} 里没有 dsh-cost-meter 插入条目`)
  return entry.config ?? {}
}

/** 读日志：`.zstd` 用系统 zstd 解，纯 `.jsonl` 直接读。 */
export function readEvents(path) {
  const text = path.endsWith('.zstd')
    ? execFileSync('zstd', ['-dc', path], { maxBuffer: 1024 * 1024 * 1024 }).toString('utf8')
    : readFileSync(path, 'utf8')
  const events = []
  let broken = 0
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      broken += 1
    }
  }
  return { events, broken }
}

/** 把整份日志折成投影状态。 */
export function foldLog(events, config) {
  const projection = createCostProjection({
    schedule: normalizeSchedule(config.schedule),
    pricing: normalizePriceTable(config.pricing),
  })
  let state = projection.init()
  for (const event of events) {
    state = projection.apply(state, event)
  }
  return { projection, state }
}

function main() {
  const target = process.argv[2]
  if (target === undefined) {
    console.error('用法：node scripts/check-real-log.mjs <session.v4.jsonl[.zstd]> [--json]')
    process.exit(2)
  }
  const config = readPluginConfig()
  const { events, broken } = readEvents(resolve(target))
  const { projection, state } = foldLog(events, config)
  const view = projection.wire.view(state)

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ events: events.length, broken, view }, null, 2))
    return
  }

  const money = (nano) => formatMoney(nano, view.currency)
  console.log(`日志事件      ${events.length}（解析失败 ${broken}）`)
  console.log(`计费调用      ${view.totals.calls}（未计价 ${view.totals.unpricedCalls}）`)
  console.log(`token 合计    ${formatTokens(view.totals.tokens)}  ` +
    `命中 ${formatTokens(view.totals.buckets.cacheHit)} / ` +
    `未命中 ${formatTokens(view.totals.buckets.cacheMiss)} / ` +
    `写入 ${formatTokens(view.totals.buckets.cacheWrite)} / ` +
    `输出 ${formatTokens(view.totals.buckets.output)}`)
  console.log(`金额合计      ${money(view.totals.nano)}  ${view.currency}`)
  console.log(`  波峰        ${money(view.periods.peak.nano)}（${formatTokens(view.periods.peak.tokens)} tok）`)
  console.log(`  波谷        ${money(view.periods.offPeak.nano)}（${formatTokens(view.periods.offPeak.tokens)} tok）`)
  console.log('按模型：')
  for (const model of view.models) {
    console.log(`  ${model.label.padEnd(22)} ${formatTokens(model.tokens).padStart(8)} tok  ` +
      `${model.priced ? money(model.nano) : '未计价'}  calls=${model.calls}`)
  }
  console.log(`桶金额       命中 ${money(view.totals.nanoByBucket.cacheHit)} / ` +
    `未命中 ${money(view.totals.nanoByBucket.cacheMiss)} / ` +
    `写入 ${money(view.totals.nanoByBucket.cacheWrite)} / ` +
    `输出 ${money(view.totals.nanoByBucket.output)}`)
  console.log(`桶合计校验    ${tokensOf(view.totals.buckets) === view.totals.tokens ? 'ok' : '不一致'}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()

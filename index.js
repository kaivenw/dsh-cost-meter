/**
 * dsh-cost-meter 宿主半侧：注册 `costMeter` 会话投影。
 *
 * 宿主侧只有一件事要做——把「用量 × 单价 × 发生时刻的时段」这笔账折叠出来。
 * 界面（状态栏那三个 pill）全在客户端半侧，它通过 slot 系统拿标准工具包里的
 * `useProjection('costMeter')` 读这里的值，不额外开 HTTP 路由。
 *
 * 单价与时段的**唯一来源**是 profile 的 cordis.patch.yml 里这个条目的 config
 * （见本包 cordis.patch.yml）。改价不用改代码、不用重新构建客户端。
 */

import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createCostProjection } from './src/host/cost-fold.js'
import { normalizeSchedule } from './src/shared/schedule.js'
import { normalizePriceTable } from './src/shared/pricing.js'

export const name = 'dsh-cost-meter'

/** 诊断路由与落盘位置：**默认关闭**，只有 config.diagnostics === true 时才注册。 */
const DIAG_ROUTE = '/api/cost-meter/diag'
const DIAG_FILE = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'cost-meter-diag.json')

/**
 * 挂载投影。
 * @param ctx - 插件上下文。
 * @param config - 本插件条目在 cordis.patch.yml 里的 config：
 *   `{ pricing: { currency, models, defaultModel }, schedule: { peakWindows, holidays, offsetMinutes } }`。
 */
export function apply(ctx, config) {
  // 配置写错时**不抛**：抛出去会让整个 profile 的加载失败，那是拿别人的整个 DSH 给我的配置错误陪葬。
  // 这里改成记一条错误日志 + 不注册——界面会显示「花费 —」，问题看得见，且不牵连别的东西。
  let projection
  try {
    projection = createCostProjection({
      schedule: normalizeSchedule(config?.schedule),
      pricing: normalizePriceTable(config?.pricing),
      diagnostics: config?.diagnostics === true,
    })
  } catch (error) {
    ctx.logger?.error?.('dsh-cost-meter: 配置有误，本次不注册花费投影：%s', error?.message ?? String(error))
    return
  }

  // 注册表可能缺席（例如不带会话投影的极简组合）：用可选注入，缺席就不注册。
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    // 注册也可能被注册表拒绝（schema 校验、key 冲突……）：同样只记日志，绝不冒泡。
    // 第三方插件在宿主里抛错会连带它之后的 bundle 一起加载不上，这条底线必须守住。
    try {
      projectionCtx.sessionProjections.register(projection)
    } catch (error) {
      ctx.logger?.error?.('dsh-cost-meter: 花费投影注册失败（已忽略）：%s', error?.message ?? String(error))
    }
  })

  // 布局排查用（默认关）：这一行本身没有槽，插件按 data-* 属性找行、按 CSS 摆位置，
  // 真出偏移时只有真实几何量能说清原因。打开后客户端会把量到的矩形与计算样式发回来落盘。
  if (config?.diagnostics !== true) return
  try {
    ctx.inject(['connection'], (connectionCtx) => {
    connectionCtx.effect(() => connectionCtx.connection.fetch.register({
      path: DIAG_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let body = null
        try {
          body = await request.json()
        } catch {
          body = null
        }
        if (body !== null) await writeFile(DIAG_FILE, JSON.stringify(body, null, 2), 'utf8').catch(() => {})
        return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } })
      },
      }), 'dsh-cost-meter: layout diagnostics route')
    })
  } catch (error) {
    // 诊断只是排查工具：它出任何问题都不许影响本插件注册，更不许影响别的 bundle 加载
    ctx.logger?.error?.('dsh-cost-meter: 诊断通道注册失败（已忽略）：%s', error?.message ?? String(error))
  }
}

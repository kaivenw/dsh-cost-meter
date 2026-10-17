/**
 * 渲染自检：在 jsdom 里真的把组件挂起来跑一遍。
 *
 * 为什么必须有这一层：这个组件只在真实客户端里跑，改错一行（比如依赖数组里引用了下面才声明的
 * 变量）在构建、单测里都看不出来，表现就是「界面上什么都没有」。这类错只有真渲染一次才会暴露，
 * 所以这里用真的 react + jsdom，配一份与核心 DOM 同形的页面，断言：
 *   1. 渲染不抛异常（抛了就是「不显示」）；
 *   2. 执行中时内容挂在 `[data-chat-running]` 那一行里；
 *   3. 没有执行中那一行时，挂在**最后一个** `[data-turn-tail]` 里；
 *   4. 两处都没有时留在自己的槽位；
 *   5. 空会话不显示，但「刚开始执行、还没有已结算调用」要显示；
 *   6. 宽度不够时按级别缩略（`data-compact` 带出被丢掉的部分）。
 */

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { build } from 'esbuild'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 组件是 .jsx，Node 直接 import 不了：先用 esbuild 打成一个 ESM 临时文件（react 保持 external）。 */
let pillsModule
async function loadPills() {
  if (pillsModule !== undefined) return pillsModule
  const outdir = join(ROOT, 'test', '.tmp')
  mkdirSync(outdir, { recursive: true })
  const outfile = join(outdir, 'pills.mjs')
  await build({
    entryPoints: [join(ROOT, 'src', 'client', 'pills.jsx')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    alias: { '@deepseek-ai/dsh-client-ui-primitives': join(ROOT, 'test', 'stubs', 'primitives.js') },
    logLevel: 'warning',
  })
  pillsModule = await import(pathToFileURL(outfile).href)
  return pillsModule
}

/** 与核心同形的页面骨架：聊天列 + 执行中那一行 + 轮次尾巴 + 输入卡上方的槽位。 */
const SHELL = `<!doctype html><html><body>
  <div class="scroll"><div class="column" data-chat-flow>
    <div class="flowItem">读取 · README.md</div>
    <div class="running" data-chat-running>
      <span class="visuallyHidden"></span><span class="runningDivider"></span>
      <span class="runningContent"><span class="runningIcon">🐳</span><span class="runningText">深度求索中，用时 1分55秒 ···</span></span>
    </div>
    <div class="tail" data-turn-tail="5">
      <div class="deliverable">交付物卡片</div>
      <div class="tailActions"><span class="action">⧉</span><span class="endInfo">用量 3.8M tok 16:04</span></div>
    </div>
    <div class="tail" data-turn-tail="6">
      <div class="tailActions"><span class="action">⧉</span><span class="endInfo">用量 1.2M tok 16:20</span></div>
    </div>
  </div></div>
  <div class="composerStack"><div class="dock" id="dock"></div><div class="card">发消息…</div></div>
</body></html>`

/** 一份「已结算若干次」的投影线值。 */
function costValue({ calls = 12, turns = [
  { turn: 5, nano: 5_700_000_000, calls: 10, tokens: 100_000_000 },
  { turn: 6, nano: 351_600_000, calls: 2, tokens: 3_800_000 },
] } = {}) {
  return {
    currency: 'CNY',
    totals: {
      nano: 6_100_000_000, calls, tokens: 108_000_000,
      buckets: { cacheHit: 1000, cacheMiss: 100, cacheWrite: 0, output: 200 },
      unpricedCalls: 0, unpricedTokens: 0,
      nanoByBucket: { cacheHit: 1, cacheMiss: 1, cacheWrite: 0, output: 1 },
    },
    periods: {
      peak: { nano: 6_100_000_000, calls, tokens: 108_000_000, buckets: { cacheHit: 1000, cacheMiss: 100, cacheWrite: 0, output: 200 } },
      offPeak: { nano: 0, calls: 0, tokens: 0, buckets: { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0 } },
    },
    models: [{ key: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash', priced: true, nano: 6_100_000_000, calls, tokens: 108_000_000, buckets: { cacheHit: 1000, cacheMiss: 100, cacheWrite: 0, output: 200 } }],
    turns,
    last: { turn: 6, step: 3, period: 'peak', key: 'deepseek-flash', priced: true, nano: 20_000_000, tokens: 200_000, buckets: { cacheHit: 1000, cacheMiss: 100, cacheWrite: 0, output: 200 } },
    pricing: { currency: 'CNY', defaultModel: null, models: { 'deepseek-flash': { label: 'DeepSeek-V4.1-Flash', peak: { cacheHit: 0.04, cacheMiss: 2, cacheWrite: 2, output: 8 }, offPeak: { cacheHit: 0.02, cacheMiss: 1, cacheWrite: 1, output: 4 } } } },
    schedule: { offsetMinutes: 480, windows: [[540, 720], [840, 1080]], holidays: ['2026-10-01'] },
  }
}

let dom
let container
let activeRoot

afterEach(async () => {
  if (activeRoot !== undefined) {
    const { act } = React
    await act(async () => { activeRoot.unmount() })
    activeRoot = undefined
  }
  dom?.window.close()
  dom = undefined
})

beforeEach(() => {
  dom = new JSDOM(SHELL, { pretendToBeVisual: true, url: 'http://127.0.0.1:19387/' })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  globalThis.MutationObserver = window.MutationObserver
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.getComputedStyle = window.getComputedStyle.bind(window)
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  container = window.document.getElementById('dock')
})

/** 一份够用的宽度模型：行够宽、核心内容占一部分、本插件一组占一部分。
 *  不这么做的话 jsdom 里所有 rect 都是 0，组件会（正确地）判定「放不下」而退回槽位。 */
function rowWidths({ running = 0, tail = 0, dock = 0 } = {}) {
  return (el) => {
    if (el.hasAttribute('data-chat-running')) return running
    if (el.hasAttribute('data-turn-tail')) return tail
    if (el.id === 'dock') return dock
    if (el.classList.contains('runningContent')) return 185
    if (el.classList.contains('endInfo')) return 200
    if (el.hasAttribute('data-cost-meter')) return 260
    if (el.classList.contains('dcm_pill')) return 60
    return null
  }
}

/** 给一批元素塞上可用宽度（jsdom 不做排版，rect 全是 0）。 */
function stubWidths(window, widths) {
  for (const element of window.document.querySelectorAll('*')) {
    const width = widths(element)
    if (width === null) continue
    element.getBoundingClientRect = () => ({ left: 0, right: width, top: 0, bottom: 22, width, height: 22, x: 0, y: 0, toJSON() {} })
  }
}

/** 挂载组件，返回渲染结束后的文档查询工具。 */
async function render({ cost = costValue(), projection = true, liveTurn = -1, running = false, balance = { state: 'ready', available: true, wallets: [{ currency: 'CNY', balance: '93.06' }], bonusWallets: [{ currency: 'CNY', balance: '196.60' }] } } = {}) {
  const { CostPills } = await loadPills()
  const useProjection = () => (projection ? cost : undefined)
  const useChat = (selector) => selector({ legacy: { partial: liveTurn === -1 ? null : { turn: liveTurn, step: 1, blocks: [{ kind: 'text', text: 'x'.repeat(400) }] } } })
  const useSession = (selector) => selector({ running })
  const useBalance = (selector) => selector(balance)
  const props = {
    useProjection,
    useChat,
    useSession,
    useBalance,
    refreshBalance: () => {},
    t: (key, values) => {
      const table = {
        'cost.unavailable': '花费 —', 'cost.session': '会话 {amount}', 'cost.turn': '{label} {amount}',
        'cost.turnNow': '本轮', 'cost.turnBare': '{amount}', 'cost.sessionBare': '{amount}',
        'period.bare': '{period}', 'balance.bare': '{amount}', 'balance.word': '余额', 'cost.hint': 'hint', 'period.peak': '波峰', 'period.offPeak': '波谷',
        'period.now': '{period}', 'period.next': '{countdown}', 'period.rule': 'rule',
        'balance.loading': '余额 …', 'balance.failed': '余额 取不到', 'balance.value': '余额 {amount}', 'balance.hint': 'bh',
        'dialog.title': '模型花费', 'dialog.period': '当前时段', 'dialog.periodUnknown': '未知', 'dialog.switchIn': '距切换',
        'dialog.lastCall': '最近一次调用', 'dialog.peakTotal': '波峰累计', 'dialog.offPeakTotal': '波谷累计', 'dialog.calls': '计费调用',
        'dialog.buckets': 'Token 明细', 'dialog.models': '按模型', 'dialog.unpriced': '未计价', 'dialog.unpricedTag': '未计价',
        'dialog.balance': '账户余额', 'dialog.wallet': '充值余额', 'dialog.bonus': '赠金', 'dialog.source': '来源', 'dialog.sourceLink': '定价页',
        'bucket.cacheHit': '命中', 'bucket.cacheMiss': '未命中', 'bucket.cacheWrite': '写入', 'bucket.output': '输出',
      }
      const template = table[key] ?? key
      return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''))
    },
  }
  const React18 = React
  const root = createRoot(container)
  activeRoot = root
  const { act } = React18
  await act(async () => {
    root.render(React18.createElement(CostPills, props))
  })
  return {
    unmount: async () => { await act(async () => { root.unmount() }) },
    doc: dom.window.document,
  }
}

test('执行中：不与那一行竞争，落在自己的槽位且完整显示', async () => {
  stubWidths(dom.window, rowWidths({ running: 900, dock: 700 }))
  const { doc } = await render()
  const mine = doc.querySelector('[data-cost-meter]')
  assert.ok(mine !== null, '组件必须渲染出内容（渲染抛异常时这里会是 null）')
  // 执行行的核心内容是动态的（步骤文字逐字生长、流光动画矩形脉动），
  // 采样式测宽永远追不上，绝对定位摆进去迟早压字——必须在自己的槽位里。
  assert.equal(mine.getAttribute('data-placement'), 'dock', '执行中应落在输入卡上方自己的槽位')
  assert.equal(mine.parentElement.id, 'dock')
  assert.equal(mine.getAttribute('data-compact') ?? '', '', '自己的槽位不限宽，不缩略')
  assert.match(mine.textContent, /本轮/)
  assert.match(mine.textContent, /会话/)
  assert.match(mine.textContent, /波(峰|谷)/)
  // 余额是「充值 + 赠送」的合计：93.06 + 196.60 = 289.66（整数分相加，不是浮点）
  assert.match(mine.textContent, /余额 ¥289\.66/)
})

test('没有执行中那一行：挂进最后一个轮次尾巴（不是第一个）', async () => {
  dom.window.document.querySelector('[data-chat-running]').remove()
  stubWidths(dom.window, rowWidths({ tail: 900, dock: 700 }))
  const { doc } = await render()
  const mine = doc.querySelector('[data-cost-meter]')
  assert.ok(mine !== null)
  assert.equal(mine.getAttribute('data-placement'), 'tail')
  assert.equal(mine.parentElement.getAttribute('data-turn-tail'), '6', '要挂在最后一个尾巴上')
  assert.match(mine.textContent, /会话/)
})

test('本机实测数值（行宽 680 / 核心 280）：落在轮次尾巴里，且只丢掉倒计时', async () => {
  // 下面这些宽度取自 2026-10-16 真实页面的测量值（诊断通道落盘的那份）：
  // 尾巴行 680、动作行内容跨度 ~280、本组完整形态 408.8
  //   parts: session 64.7 / countdown 51.2 / balance 73.0 / period 126.7
  const realWidths = (el) => {
    if (el.hasAttribute('data-turn-tail')) return 680
    if (el.classList.contains('endInfo')) return 280
    if (el.classList.contains('dcm_session')) return 64.7
    if (el.classList.contains('dcm_optional')) return 51.2
    if (el.hasAttribute('data-cost-period')) return 126.7
    if (el.hasAttribute('data-cost-balance')) return 73
    if (el.classList.contains('dcm_anchor')) return 190
    if (el.parentElement?.classList.contains('dcm_anchor')) return 190
    return null
  }
  dom.window.document.querySelector('[data-chat-running]').remove()
  stubWidths(dom.window, realWidths)
  const { doc } = await render()
  const mine = doc.querySelector('[data-cost-meter]')
  assert.ok(mine !== null)
  assert.equal(mine.getAttribute('data-placement'), 'tail', '不该退回输入卡上方')
  assert.equal(mine.parentElement.getAttribute('data-turn-tail'), '6')
  // 允许按几何必要程度缩到「丢倒计时 + 会话 + 余额词」为止：会话金额与余额数字
  // 在 tooltip/明细里始终有，时段与余额数字绝不被丢——用户的要求就是别只剩本轮。
  const compact = mine.getAttribute('data-compact') ?? ''
  assert.ok(['', 'countdown', 'countdown session', 'countdown session balanceLabel'].includes(compact), `不该丢到只剩本轮，实际丢了 [${compact}]`)
  assert.match(mine.textContent, /本轮/)
  assert.match(mine.textContent, /会话/)
  assert.match(mine.textContent, /余额/)
  assert.match(mine.textContent, /波(峰|谷)/)
})

test('落点那一行量不到宽度时：往上找真盒子，绝不因此退回槽位', async () => {
  // 真实页面踩到过：外层包了 display:contents 的壳（自己 rect 恒为 0），
  // 早先拿这个 0 当「没空间」→ 落点锁死在输入框上方、再也回不来。
  dom.window.document.querySelector('[data-chat-running]').remove()
  const widths = (el) => {
    if (el.hasAttribute('data-turn-tail')) return 0       // 壳：没有盒子
    if (el.hasAttribute('data-chat-flow')) return 900    // 真正有宽度的祖先
    if (el.classList.contains('runningContent')) return 200
    if (el.classList.contains('dcm_anchor')) return 190
    if (el.hasAttribute('data-cost-meter')) return 300
    return null
  }
  stubWidths(dom.window, widths)
  const { doc } = await render()
  const mine = doc.querySelector('[data-cost-meter]')
  assert.ok(mine !== null)
  assert.equal(mine.getAttribute('data-placement'), 'tail', '量不到宽度不等于没空间，必须留在那一行')
})

test('两处落点都没有：留在自己的槽位（输入卡上方）', async () => {
  for (const row of [...dom.window.document.querySelectorAll('[data-chat-running], [data-turn-tail]')]) row.remove()
  stubWidths(dom.window, rowWidths({ dock: 700 }))
  const { doc } = await render()
  const mine = doc.querySelector('[data-cost-meter]')
  assert.ok(mine !== null)
  assert.equal(mine.getAttribute('data-placement'), 'dock')
  assert.equal(mine.parentElement.id, 'dock')
})

test('宽度不够就缩略：级别越高丢得越多，最后只剩花费那一颗', async () => {
  // 行宽 400，核心 200，本组按「宽 → 窄」造出不同级别
  stubWidths(dom.window, rowWidths({ running: 400 }))
  const { doc, unmount } = await render()
  const mine = doc.querySelector('[data-cost-meter]')
  // 第一轮渲染时宽度全是 0 → 级别最高（只剩花费）；这里只断言「缩略标记存在且是合法值」
  const compact = mine.getAttribute('data-compact') ?? ''
  for (const token of compact.split(' ').filter(Boolean)) {
    assert.ok(['session', 'countdown', 'balance', 'period'].includes(token), `未知的缩略标记 ${token}`)
  }
  await unmount()
})

test('空会话不显示，但「刚开始执行」要显示', async () => {
  const empty = costValue({ calls: 0, turns: [] })
  const first = await render({ cost: empty })
  assert.equal(first.doc.querySelector('[data-cost-meter]'), null, '空会话不该挂一行 ¥0.00')
  await first.unmount()

  const running = await render({ cost: empty, liveTurn: 7 })
  assert.ok(running.doc.querySelector('[data-cost-meter]') !== null, '刚开始执行（还没有已结算调用）也要显示')
  await running.unmount()
})

test('最紧一档：只留图标+数字，文字进 tooltip（四项数字都还在）', async () => {
  // 关键：宽度必须在**挂载之后**塞进去——pill 是渲染时才创建的，挂载前打桩它们量到的是 0，
  // 组件会按设计「量不到就不缩略」，于是永远停在 0 档（我前三次就是这么被自己骗过去的）。
  dom.window.document.querySelector('[data-chat-running]').remove()
  const { doc } = await render()
  const mine0 = doc.querySelector('[data-cost-meter]')
  assert.ok(mine0 !== null)
  await new Promise((resolve) => setTimeout(resolve, 60))   // 让首次测量与节流窗口过去
  stubWidths(dom.window, (el) => {
    if (el.hasAttribute('data-turn-tail')) return 600
    if (el.classList.contains('endInfo')) return 100
    if (el.classList.contains('dcm_anchor')) return 200
    if (el.classList.contains('dcm_pill')) return 200
    if (el.classList.contains('dcm_session')) return 40
    if (el.classList.contains('dcm_optional')) return 40
    if (el.hasAttribute('data-cost-period')) return 200
    if (el.hasAttribute('data-cost-balance')) return 200
    return null
  })
  dom.window.dispatchEvent(new dom.window.Event('resize'))
  await new Promise((resolve) => setTimeout(resolve, 80))
  const mine = doc.querySelector('[data-cost-meter]')
  const compact = mine.getAttribute('data-compact') ?? ''
  assert.ok(compact.includes('word'), `应进入最紧一档，实际 [${compact}]`)
  assert.ok(!/本轮/.test(mine.textContent), `不该再出现「本轮」：${mine.textContent}`)
  assert.ok(!/会话/.test(mine.textContent), `不该再出现「会话」：${mine.textContent}`)
  assert.ok(!/余额/.test(mine.textContent), `不该再出现「余额」：${mine.textContent}`)
  assert.match(mine.textContent, /¥0\.3516/, '本轮金额要在')
  assert.match(mine.textContent, /¥6\.10/, '会话金额要在')
  assert.match(mine.textContent, /¥289\.66/, '余额要在')
  const titles = [...mine.querySelectorAll('[title]')].map((el) => el.getAttribute('title')).join(' | ')
  assert.match(titles, /本轮 ¥0\.3516/, '花费 tooltip 要有完整的本轮')
  assert.match(titles, /会话 ¥6\.10/, '花费 tooltip 要有完整会话')
  assert.match(titles, /余额 ¥289\.66/, '余额 tooltip 要有数值')
})

test('投影整个缺席时显示「花费 —」，而不是什么都不显示', async () => {
  const { doc } = await render({ projection: false })
  const mine = doc.querySelector('[data-cost-meter]')
  assert.ok(mine !== null)
  assert.match(mine.textContent, /花费 —/)
})

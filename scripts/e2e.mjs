/**
 * 端到端自检：把**真实的 client.js** 放进**真实浏览器**（无头 Edge）里跑起来。
 *
 * 和别的自检有什么区别：
 *   - test/*.test.mjs 是 jsdom（没有排版引擎，rect 全是 0，测的是逻辑与不抛异常）；
 *   - scripts/layout-check.mjs 只渲染静态 HTML + 真实 CSS（测的是 CSS，不跑组件）；
 *   这一个：真 bundle + 真 DOM + **真排版**，走完整链路——扫落点、portal、量宽度、
 *   定缩略级别、按级别隐藏。既要能看出「位置对不对、有没有压住核心内容」，
 *   也要能看出「窗口/字号变了会不会来回跳」。
 *
 * 用法：node scripts/e2e.mjs [--width 1280] [--shots]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CSS as PLUGIN_CSS } from '../src/client/styles.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'layout-check')
/** 找一个无头浏览器：可用 BROWSER_BIN 覆盖；macOS / Windows / Linux 各试常见路径。 */
function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    process.platform === 'darwin' ? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' : null,
    process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null,
    process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : null,
    process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : null,
    process.platform === 'linux' ? '/usr/bin/microsoft-edge' : null,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : null,
    process.platform === 'linux' ? '/usr/bin/chromium' : null,
  ].filter((value) => typeof value === 'string' && value !== '')
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`没找到无头浏览器；用 BROWSER_BIN=<可执行文件路径> 指定。试过：${candidates.join(' / ')}`)
}

const WIDTH = Number(process.argv[process.argv.indexOf('--width') + 1]) || 1280
const SHOTS = process.argv.includes('--shots')

/** 核心 CSS：抄自 dsh-client-ui-chat / dsh-client-ui-conversation 的产物（只换类名）。
 *  `--dsh-chat-content-width` 设成 680px，与本机真实页面量到的一致。 */
const CORE_CSS = `
:root{
  --dsh-chat-content-width:680px;
  --dsh-content-font-size-secondary:13px;
  --dsh-content-font-delta-secondary:0px;
  --dsh-content-font-size:14px;
  --dsh-content-font-delta:0px;
  --dsh-composer-side-clearance:180px;
  --dsh-composer-card-max-width:1440px;
  --dsw-alias-label-tertiary:#8a8f98;
  --dsw-alias-label-secondary:#5b6069;
  --dsw-alias-label-primary:#1c1e21;
  --dsw-alias-separator-primary:#d0d3d8;
  --dsw-alias-interactive-bg-hover:#f0f1f3;
  --dsw-alias-label-deep-diving:#3b6ef6;
}
*{box-sizing:border-box}
body{margin:0;font:14px/22px -apple-system,"PingFang SC",system-ui;color:#1c1e21;background:#fff}
.scroll{padding:16px calc(var(--dsh-composer-side-clearance) + 16px) 8px}
.column{max-width:var(--dsh-chat-content-width);flex-direction:column;width:100%;margin:0 auto;display:flex;gap:12px}
.running{color:var(--dsw-alias-label-deep-diving);font-size:calc(var(--dsh-content-font-size) - 2px);line-height:calc(22px + var(--dsh-content-font-delta));flex-direction:column;align-items:flex-start;display:flex}
.runningDivider{display:none;background:#e5e7eb;width:100%;height:.5px;margin:8px 0 10px}
.runningContent{align-items:center;gap:6px;min-width:0;display:inline-flex}
.runningText{font-variant-numeric:tabular-nums;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}
.tail{flex-direction:column;gap:16px;display:flex}
.tailActions{margin-top:4px;margin-left:-6px;height:28px;align-items:center;gap:8px;display:flex;color:#8a8f98}
.endInfo{min-width:0;color:#8a8f98;align-items:center;gap:8px;margin-left:8px;display:inline-flex}
.action{width:28px;height:28px;border-radius:6px;justify-content:center;align-items:center;display:inline-flex;font-size:14px}
.composerStack{padding:0 calc(var(--dsh-composer-side-clearance) + 16px) 12px;display:flex;flex-direction:column;gap:6px}
.contentsWrapper{display:contents}
.dock{display:flex;justify-content:center;padding:0 8px}
.card{border:.5px solid var(--dsw-alias-separator-primary);border-radius:16px;min-height:120px;padding:16px;color:#8a8f98;max-width:var(--dsh-composer-card-max-width);margin:0 auto;width:100%}
`

const SHELL = `
<div class="scroll"><div class="column" data-chat-flow>
  <div class="flowItem">读取 · README.md</div>
  <div class="running" data-chat-running>
    <span class="visuallyHidden"></span><span class="runningDivider"></span>
    <span class="runningContent"><span class="runningIcon">🐳</span><span class="runningText">深度求索中，用时 10 秒 ···</span></span>
  </div>
  <div class="tail" data-turn-tail="5"><div class="tailActions"><span class="action">⧉</span><span class="action">👍</span><span class="action">👎</span><span class="action">↗</span><span class="endInfo">用量 1.2M tok&nbsp;&nbsp;16:20</span></div></div>
</div></div>
<div class="composerStack"><div class="contentsWrapper" id="wrap"><div id="dock" class="dock"></div></div><div class="card">发消息或创建任务，/ 调用指令，@ 文件或对话</div></div>
`

/** 页面脚本：装 seed、加载真 bundle、按平台同形的契约调 apply、渲染、断言。 */
const HARNESS = String.raw`
(function () {
  const seeds = {
    'react': window.React,
    'react-dom': window.ReactDOM,
    'react-dom/client': { createRoot: window.ReactDOM.createRoot },
    'react/jsx-runtime': { jsx: window.React.createElement, jsxs: window.React.createElement, Fragment: window.React.Fragment },
    '@deepseek-ai/dsh-client-ui-primitives': (function () {
      const icon = (name) => function Icon(props) {
        return window.React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'data-icon': name })
      }
      return { IconClockOutlineRegular: icon('clock'), IconWalletCardOutlineRegular: icon('wallet'), IconYuanCoinOutlineRegular: icon('coin') }
    })(),
    'dsh-client-store': {}, 'dsh-client-ui-slots': {}, 'dsh-client-ui-dockkit': {}, 'dsh-client-ui-primitives': {},
  }
  const loaded = {}
  window.__ModuleLoader__ = { load(decl) { loaded[decl.id] = decl.factory } }

  window.addEventListener('error', (event) => verdict({ ok: false, fatal: '页面错误: ' + event.message }))
  window.addEventListener('unhandledrejection', (event) => verdict({ ok: false, fatal: '未处理的 rejection: ' + (event.reason && event.reason.message) }))
  if (!window.React || !window.ReactDOM) {
    verdict({ ok: false, fatal: 'React/ReactDOM 没加载（检查 node_modules 里的 umd 路径）' })
    return
  }
  const mark = (text) => {
    let pre = document.getElementById('boot')
    if (pre === null) { pre = document.createElement('pre'); pre.id = 'boot'; document.body.appendChild(pre) }
    pre.textContent += text + '\n'
  }
  window.__mark = mark

  const script = document.createElement('script')
  script.src = '../client.js'
  script.onload = () => { mark('bundle loaded: ' + Object.keys(loaded).join(',')); run() }
  script.onerror = () => verdict({ ok: false, fatal: 'client.js 没加载成功' })
  document.head.appendChild(script)

  const require = (id) => {
    if (id in seeds) return seeds[id]
    throw new Error('seed 未提供: ' + id)
  }

  const FAKE = {
    currency: 'CNY',
    diagnostics: false,
    totals: {
      nano: 8300000000, calls: 92, tokens: 167000000,
      buckets: { cacheHit: 160000000, cacheMiss: 900000, cacheWrite: 0, output: 430000 },
      unpricedCalls: 0, unpricedTokens: 0,
      nanoByBucket: { cacheHit: 1, cacheMiss: 1, cacheWrite: 0, output: 1 },
    },
    periods: {
      peak: { nano: 8300000000, calls: 92, tokens: 167000000, buckets: { cacheHit: 160000000, cacheMiss: 900000, cacheWrite: 0, output: 430000 } },
      offPeak: { nano: 0, calls: 0, tokens: 0, buckets: { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0 } },
    },
    models: [{ key: 'deepseek-flash', label: 'DeepSeek-V4.1-Flash', priced: true, nano: 8300000000, calls: 92, tokens: 167000000, buckets: { cacheHit: 160000000, cacheMiss: 900000, cacheWrite: 0, output: 430000 } }],
    turns: [
      { turn: 5, nano: 4000000000, calls: 40, tokens: 90000000 },
      { turn: 6, nano: 4300000000, calls: 52, tokens: 77000000 },
    ],
    last: { turn: 6, step: 3, period: 'peak', key: 'deepseek-flash', priced: true, nano: 10000000, tokens: 100000, buckets: { cacheHit: 100000, cacheMiss: 1000, cacheWrite: 0, output: 2000 } },
    pricing: { currency: 'CNY', defaultModel: null, models: { 'deepseek-flash': { label: 'DeepSeek-V4.1-Flash', peak: { cacheHit: 0.04, cacheMiss: 2, cacheWrite: 2, output: 8 }, offPeak: { cacheHit: 0.02, cacheMiss: 1, cacheWrite: 1, output: 4 } } } },
    schedule: { offsetMinutes: 480, windows: [[540, 720], [840, 1080]], holidays: [] },
  }

  const BALANCE = { state: 'ready', available: true, wallets: [{ currency: 'CNY', balance: '93.06' }], bonusWallets: [{ currency: 'CNY', balance: '196.60' }] }

  let dictionaries = { zh: {}, en: {} }
  let entry = null
  let liveChars = 400
  let running = true
  let cost = FAKE

  /** 平台同形的 ctx 替身：只实现本插件真正用到的那几处契约。 */
  function makeCtx() {
    return {
      effect(fn) { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
      locale: {
        register(ns, dict) { dictionaries = dict; return () => {} },
        getSnapshot: () => ({ active: 'zh' }),
      },
      inject(deps, callback) {
        if (deps.includes('remote.account')) {
          callback({
            remote: {
              account: {
                getBalance: async () => ({ ok: true, value: { value: [{ currency: 'CNY', balance: '93.06' }], bonusWallets: [{ currency: 'CNY', balance: '196.60' }] } }),
              },
            },
          })
        }
        return () => {}
      },
      slots: {
        inject(name, callback) { callback(); return () => {} },
        register(decl, Component) { entry = { decl, Component }; return () => {} },
      },
    }
  }

  function translator(dict) {
    return (key, values) => {
      const template = dict[key] ?? key
      return String(template).replace(/\{(\w+)\}/g, (_, name) => String((values || {})[name] ?? ''))
    }
  }

  let root = null
  function render() {
    const props = {
      sessionId: 'session-e2e',
      useProjection: () => cost,
      useChat: (selector) => selector({
        legacy: { partial: running ? { turn: 6, step: 4, blocks: [{ kind: 'text', text: 'x'.repeat(liveChars) }] } : null },
        timeline: { turnOrder: [5, 6] },
      }),
      useSession: (selector) => selector({ running }),
      useBalance: (selector) => selector(BALANCE),
      refreshBalance: () => {},
      hooks: { balance: { getSnapshot: () => BALANCE, subscribe: () => () => {} } },
      t: translator(dictionaries.zh || {}),
    }
    if (root === null) root = window.ReactDOM.createRoot(document.getElementById('dock'))
    root.render(window.React.createElement(entry.Component, props))
  }

  // 用 setTimeout 而不是 requestAnimationFrame：无头环境里 rAF 可能被节流甚至不触发。
  const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 32))
  const round = (value) => Math.round(value * 10) / 10

  /** 一个元素**内容**的横向跨度：子元素 left/right 的并集（拉伸到整行的 flex 行不能看自身宽度）。 */
  function extent(element) {
    let min = Infinity, max = -Infinity
    for (const child of element.children) {
      const box = child.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      min = Math.min(min, box.left); max = Math.max(max, box.right)
    }
    return Number.isFinite(min) ? Math.max(0, max - min) : element.getBoundingClientRect().width
  }

  /** 元素**内容**的右边界：子元素 right 的最大值。拉伸到整行的 flex 行（动作行）不能看自身 rect。 */
  function contentRight(element) {
    let max = -Infinity
    for (const child of element.children) {
      const box = child.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      max = Math.max(max, box.right)
    }
    return Number.isFinite(max) ? max : element.getBoundingClientRect().right
  }

  function snapshot(label) {
    const mine = document.querySelector('[data-cost-meter]')
    const row = mine ? mine.parentElement : null
    const core = row ? [...row.children].filter((child) => child !== mine) : []
    const coreRight = core.reduce((right, child) => Math.max(right, contentRight(child)), 0)
    const coreExtent = core.reduce((widest, child) => {
      const width = extent(child)
      const rowWidth = row.getBoundingClientRect().width
      return width > 0 && width < rowWidth - 1 ? Math.max(widest, width) : widest
    }, 0)
    const mineBox = mine ? mine.getBoundingClientRect() : null
    const rowBox = row ? row.getBoundingClientRect() : null
    return {
      label,
      placement: mine ? mine.getAttribute('data-placement') : null,
      compact: mine ? (mine.getAttribute('data-compact') || '') : null,
      text: mine ? mine.textContent : null,
      row: row ? { tag: row.tagName, attr: row.hasAttribute('data-chat-running') ? 'running' : row.getAttribute('data-turn-tail') } : null,
      rowWidth: rowBox ? round(rowBox.width) : null,
      coreExtent: round(coreExtent),
      mine: mineBox ? { left: round(mineBox.left), right: round(mineBox.right), width: round(mineBox.width), height: round(mineBox.height), top: round(mineBox.top), bottom: round(mineBox.bottom) } : null,
      mineStyleMaxWidth: mine ? getComputedStyle(mine).maxWidth : null,
      minePosition: mine ? getComputedStyle(mine).position : null,
      overlap: mineBox && row ? round(coreRight - mineBox.left) : null,
      wraps: mineBox ? mineBox.height > 26 : null,
      rightSlack: mineBox && rowBox ? round(rowBox.right - mineBox.right) : null,
      coreMidY: core.length > 0 ? round(core[core.length - 1].getBoundingClientRect().top + core[core.length - 1].getBoundingClientRect().height / 2) : null,
      mineMidY: mineBox ? round(mineBox.top + mineBox.height / 2) : null,
    }
  }

  function verdict(result) {
    const pre = document.createElement('pre')
    pre.id = 'verdict'
    pre.textContent = JSON.stringify(result, null, 2)
    document.body.appendChild(pre)
  }

  async function run() {
    try {
      await runChecks()
    } catch (error) {
      verdict({ ok: false, fatal: '自检过程抛异常: ' + (error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error)) })
    }
  }

  async function runChecks() {
    const checks = []
    mark('run 开始，entry=' + (entry === null ? 'null' : 'ok'))
    const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

    try {
      const factory = loaded['dsh-cost-meter']
      if (typeof factory !== 'function') { verdict({ ok: false, fatal: 'bundle 里没有 dsh-cost-meter 导出' }); return }
      const mod = factory(require)
      mod.apply(makeCtx(), { diagnostics: false })
      if (entry === null) { verdict({ ok: false, fatal: 'slot 没注册' }); return }
    } catch (error) {
      verdict({ ok: false, fatal: 'apply 抛异常: ' + error.message })
      return
    }

    render()
    await nextFrame()
    await new Promise((resolve) => setTimeout(resolve, 120))
    mark('首次渲染后 mine=' + (document.querySelector('[data-cost-meter]') === null ? 'null' : 'ok'))

    // ① 执行中：落在那一行里，不压核心内容、不换行、同一行
    const running1 = snapshot('running')
    check('执行中：落在 [data-chat-running] 里', running1.row && running1.row.attr === 'running' && running1.placement === 'running', running1)
    check('执行中：绝对定位生效', running1.minePosition === 'absolute', running1.minePosition)
    check('执行中：不压住核心内容', running1.overlap !== null && running1.overlap <= 1, { overlap: running1.overlap })
    check('执行中：不换行', running1.wraps === false, { height: running1.mine && running1.mine.height })
    check('执行中：与核心文字同一行', Math.abs(running1.coreMidY - running1.mineMidY) <= 8, { coreMidY: running1.coreMidY, mineMidY: running1.mineMidY })
    check('执行中：右端贴齐那一行', Math.abs(running1.rightSlack) <= 1, { rightSlack: running1.rightSlack })
    check('执行中：不是只剩本轮', running1.text && running1.text.includes('本轮') && running1.text.includes('波峰') && running1.text.includes('余额'), running1.text)

    // ② 稳定性：金额一直长、每帧重渲染，落点与缩略级别都不许变
    const before = snapshot('before-growth')
    for (let step = 0; step < 8; step += 1) {
      liveChars += 400
      cost = Object.assign({}, cost, {
        totals: Object.assign({}, cost.totals, { nano: cost.totals.nano + 13000000, calls: cost.totals.calls + 1 }),
        last: Object.assign({}, cost.last, { nano: cost.last.nano + 13000000 }),
      })
      render()
      await nextFrame()
    }
    const after = snapshot('after-growth')
    check('稳定性：8 次更新后落点不变', before.placement === after.placement && before.row.attr === after.row.attr, { before: before.row, after: after.row })
    check('稳定性：8 次更新后缩略级别不变', before.compact === after.compact, { before: before.compact, after: after.compact })
    check('稳定性：更新后仍然不压核心内容', after.overlap !== null && after.overlap <= 1, { overlap: after.overlap })
    check('稳定性：更新后仍然不换行', after.wraps === false, { height: after.mine && after.mine.height })

    // ③ 任务结束（没有执行中那一行）：落到最后一个尾巴、同样不压核心内容
    running = false
    document.querySelector('[data-chat-running]').remove()
    render()
    await nextFrame()
    await new Promise((resolve) => setTimeout(resolve, 120))
    mark('首次渲染后 mine=' + (document.querySelector('[data-cost-meter]') === null ? 'null' : 'ok'))
    const tail = snapshot('tail')
    check('结束后：落在轮次尾巴里', tail.row && tail.row.attr === '5' && tail.placement === 'tail', tail)
    check('结束后：不压住核心内容', tail.overlap !== null && tail.overlap <= 1, { overlap: tail.overlap })
    check('结束后：不换行', tail.wraps === false, { height: tail.mine && tail.mine.height })
    check('结束后：与动作行同一行', Math.abs(tail.coreMidY - tail.mineMidY) <= 8, { coreMidY: tail.coreMidY, mineMidY: tail.mineMidY })

    // ④ 变窄（模拟别人电脑上的小窗口 / 大字号）：不许压核心内容，也不许整条消失
    document.documentElement.style.setProperty('--dsh-chat-content-width', '420px')
    window.dispatchEvent(new Event('resize'))
    await nextFrame()
    await new Promise((resolve) => setTimeout(resolve, 400))
    const narrow = snapshot('narrow')
    check('窄列：仍然看得见', narrow.text !== null && narrow.text.length > 0, narrow.text)
    check('窄列：不压住核心内容或已退回槽位', narrow.placement === 'dock' || (narrow.overlap !== null && narrow.overlap <= 1), { overlap: narrow.overlap, placement: narrow.placement })
    check('窄列：不换行', narrow.wraps === false, { height: narrow.mine && narrow.mine.height })

    verdict({ ok: checks.every((item) => item.ok), width: window.innerWidth, checks, measurements: { running: running1, afterGrowth: after, tail, narrow } })
  }
})()
`

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${CORE_CSS}\n${PLUGIN_CSS}</style>
<script src="../node_modules/react/umd/react.development.js"></script>
<script src="../node_modules/react-dom/umd/react-dom.development.js"></script>
</head><body>${SHELL}
<script>${HARNESS}</script>
</body></html>`

mkdirSync(OUT, { recursive: true })
const page = join(OUT, 'e2e.html')
writeFileSync(page, html)

const args = [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--window-size=${WIDTH},900`,
  '--virtual-time-budget=3000',
]
if (SHOTS) args.push(`--screenshot=${join(OUT, `e2e-${WIDTH}.png`)}`)
args.push('--dump-dom', `file://${page}`)
const dom = execFileSync(findBrowser(), args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000, killSignal: 'SIGKILL' })
const matched = /<pre id="verdict">([\s\S]*?)<\/pre>/.exec(dom)
if (matched === null) {
  console.error('没有拿到结论页；DOM 片段：')
  console.error(dom.slice(0, 1200))
  process.exit(1)
}
const verdict = JSON.parse(matched[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
console.log(`窗口宽度 ${verdict.width ?? WIDTH} | 结论：${verdict.ok ? '全部通过' : '有失败项'}`)
if (verdict.fatal !== undefined) console.error('致命：', verdict.fatal)
for (const item of verdict.checks ?? []) {
  console.log(`${item.ok ? '✔' : '✖'} ${item.name}`)
  if (!item.ok) console.log('   ', JSON.stringify(item.detail))
}
if (verdict.measurements !== undefined) {
  console.log('--- 关键测量 ---')
  for (const [name, snap] of Object.entries(verdict.measurements)) {
    console.log(`${name}: 落点=${snap.placement} 缩略=[${snap.compact}] 行宽=${snap.rowWidth} 核心=${snap.coreExtent} 我的左边界=${snap.mine && snap.mine.left} 压住=${snap.overlap} 右端余量=${snap.rightSlack} 高=${snap.mine && snap.mine.height}`)
    console.log(`   文案：${snap.text}`)
  }
}
process.exit(verdict.ok ? 0 : 1)

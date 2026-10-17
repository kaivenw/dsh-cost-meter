/**
 * 布局诊断（**默认关闭**，profile 里 `config.diagnostics: true` 才启用）。
 *
 * 为什么留着它：这一行本身没有槽，插件是按 `data-*` 属性找行、按 CSS 摆位置的。
 * 真出现偏移/缩略过头时，光看截图只能猜；把真实矩形与计算样式发回宿主落盘，
 * 一眼就能看出是「行宽量错了」还是「核心内容量宽了」。
 *
 * 开关从投影线值传来（`costMeter.diagnostics`）：关着的时候这个模块除了一个
 * `if` 什么也不做，交付给别人的包里它是死代码。
 */

/** 采集一份测量结果（纯读，不改页面）。 */
function collect(reason) {
  const round = (value) => Math.round(value * 10) / 10
  const rect = (element) => {
    if (element === null || element === undefined) return null
    const box = element.getBoundingClientRect()
    return {
      left: round(box.left), top: round(box.top), width: round(box.width), height: round(box.height),
      right: round(box.right), bottom: round(box.bottom),
    }
  }
  const style = (element, props) => {
    if (element === null || element === undefined) return null
    const computed = getComputedStyle(element)
    const out = {}
    for (const prop of props) out[prop] = computed.getPropertyValue(prop)
    return out
  }
  const describe = (element) => (element === null || element === undefined ? null : {
    tag: element.tagName,
    className: typeof element.className === 'string' ? element.className.slice(0, 60) : '',
    dataChatRunning: element.hasAttribute('data-chat-running'),
    dataTurnTail: element.getAttribute('data-turn-tail'),
    rect: rect(element),
    style: style(element, ['display', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'position', 'width', 'overflow']),
  })
  const mine = document.querySelector('[data-cost-meter]')
  // 页面上**所有**本插件元素：两份实例时第二份可能在槽位里，只报第一个是看不见它的
  const allMine = [...document.querySelectorAll('[data-cost-meter]')].map((element) => ({
    rect: rect(element),
    placement: element.getAttribute('data-placement'),
    compact: element.getAttribute('data-compact'),
    parent: element.parentElement === null ? null : {
      tag: element.parentElement.tagName,
      className: typeof element.parentElement.className === 'string' ? element.parentElement.className.slice(0, 40) : '',
      running: element.parentElement.hasAttribute('data-chat-running'),
      tail: element.parentElement.getAttribute('data-turn-tail'),
    },
  }))
  const rows = [...document.querySelectorAll('[data-chat-running], [data-turn-tail]')]
  return {
    reason,
    at: new Date().toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    column: describe(document.querySelector('[data-chat-flow]')),
    mineCount: allMine.length,
    allMine,
    rows: rows.map((row) => ({
      ...describe(row),
      children: [...row.children].map((child) => ({
        ...describe(child),
        isMine: child.hasAttribute('data-cost-meter'),
        position: getComputedStyle(child).position,
      })),
    })),
    mine: mine === null ? null : {
      ...describe(mine),
      placement: mine.getAttribute('data-placement'),
      compact: mine.getAttribute('data-compact'),
      text: mine.textContent,
      pills: [...mine.children].map((pill) => ({ className: String(pill.className).slice(0, 40), rect: rect(pill) })),
    },
  }
}

/**
 * 建立上报器：同一帧只发一次，两次至少间隔 700ms，失败静默（诊断绝不能影响界面）。
 * @returns `(reason) => void`。
 */
export function createLayoutReporter() {
  const MIN_INTERVAL_MS = 700
  let lastAt = 0
  let inflight = false
  return (reason) => {
    const now = Date.now()
    if (inflight || now - lastAt < MIN_INTERVAL_MS) return
    lastAt = now
    inflight = true
    let payload
    try {
      payload = collect(reason)
    } catch {
      inflight = false
      return
    }
    try {
      fetch('/api/cost-meter/diag', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {}).finally(() => {
        inflight = false
      })
    } catch {
      inflight = false
    }
  }
}

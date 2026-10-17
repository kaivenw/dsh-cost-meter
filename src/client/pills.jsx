/**
 * 状态栏里的三个 pill：花费、时段、余额。
 *
 * 挂在 `conversation.composer.dock`（`kind: list`、`scope: session`）里，
 * 与官方那两个 pill 同一行：dock 容器是 `justify-content:center; gap:12px` 的 flex 行，
 * 两个 poll 的字段来源见下面的注释。会话作用域的 slot 会由框架带下标准工具包，
 * `useProjection` 就是从这里拿到的——所以金额不需要自己开 HTTP 路由。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconClockOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconWalletCardOutlineRegular, IconYuanCoinOutlineRegular } from './icons.jsx'
import { CLASS } from './styles.js'
import { CLOCK_TICK_MS, PROJECTION_KEY, symbolOf, sumWallets, formatCents, parseAmountToCents } from './api.js'
import { DROP_ORDER, contentExtent, measureParts, measurableBox, minimumRowWidth, nextCompactLevel, shouldUseDock } from './compact.js'
import { createLayoutReporter } from './diagnose.js'
import { estimateInFlightNano, partialChars } from './estimate.js'
import { formatCountdown, nextPeriodChangeAt, periodAt, scheduleFromWire } from '../shared/schedule.js'
import { formatMoney, formatTokens } from '../shared/pricing.js'

/**
 * 同一个页面只允许一个实例渲染。
 *
 * 槽位 `conversation.input.dock` 在某些布局/过渡里会被渲染两次（两个 composer 实例），
 * 那样就会看到两份数字、并且两份各自量宽度、各自改落点——表现就是「上下各一份、还在抖」。
 * 这里用电选的方式只让第一个实例出内容，它卸载后由下一个顶上。
 */
let instanceSeq = 0
let activeInstance = null
const instanceListeners = new Set()

/**
 * 跨模块实例的归属标记：模块级变量只在「同一份 bundle 的同一个模块作用域」里有效，
 * 若页面同时加载了两份修订（旧包还在跑），两份各自都会认为自己该渲染——于是出现
 * 输入卡上方一份、时间右边一份，互相抢落点。把归属写到 `document.body` 这个**全局**位置，
 * 无论几份 bundle 都只有一份能渲染。
 * 认领发生在**渲染期**（空位即占），持有者卸载时摘牌——摘牌后幸存实例下一次渲染
 * 立刻接上；绝不把别人的令牌当自己的（继承会让「摘牌之后无人接手」，
 * 重挂载竞态后整条就彻底消失了）。
 */
const OWNER_ATTR = 'data-dcm-owner'

/** 布局诊断上报器（默认关：只有线值里 diagnostics 为 true 时才会被调用）。 */
const reportLayout = createLayoutReporter()

/** 单价出处。界面上要能点到出处，否则「这个价从哪来的」没人答得上来。 */
const PRICING_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'

/** 每秒一跳的时钟。只在需要倒计时时开，不用时不建定时器。 */
function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/** 弹层贴着 pill 向上展开，并夹在视口内。 */
function usePanelPosition(anchorRef, open) {
  const [position, setPosition] = useState(null)
  useEffect(() => {
    if (!open) {
      setPosition(null)
      return undefined
    }
    const measure = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const width = Math.min(460, window.innerWidth - 24)
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12))
      setPosition({ left, bottom: Math.max(12, window.innerHeight - rect.top + 8) })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchorRef, open])
  return position
}

/**
 * 找当前该落进去的那一行 DOM。两条规则，按优先级：
 *   1. 执行中 → 「深度求索中，用时 …」那一行（`data-chat-running`）；
 *   2. 否则   → 聊天的**最后一个**轮次尾巴（`data-turn-tail`），也就是「用量 … / 时间」那一行。
 *
 * 为什么不按轮次号判断、而直接认 DOM 里的最后一行：轮次号线值（owner 的 `turn`、
 * 快照的 `turnOrder`）在停止任务、分页加载、重放这些路径上都可能对不齐，而「要显示在哪一行」
 * 本来就只是个位置问题——认最后一行既简单又不会错。两行都没有时返回 `dock`，
 * 调用方退回输入卡上方那一条，保证任何时刻都有地方显示。
 *
 * 这些行随轮次出现/消失，所以用 MutationObserver 跟着扫。回调里**同步**扫一次，
 * 不排到 requestAnimationFrame：窗口在后台、或某些无头环境下 rAF 会被节流甚至不触发，
 * 那样行已经换了、条目还挂在旧行上（实测踩到过）。只监听 childList，
 * 文字逐字更新不触发重扫，流式期间也不会打爆主线程。
 *
 * @returns `{ kind, node }`：kind 是 `running` / `tail` / `dock`，node 是要 portal 进去的元素。
 */
function useAnchorRow() {
  const [anchor, setAnchor] = useState({ kind: 'dock', node: null })
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return undefined
    const scan = () => {
      const running = document.querySelector('[data-chat-running]')
      if (running !== null) return { kind: 'running', node: running }
      const tails = document.querySelectorAll('[data-turn-tail]')
      const last = tails.length > 0 ? tails[tails.length - 1] : null
      return last === null ? { kind: 'dock', node: null } : { kind: 'tail', node: last }
    }
    const sync = () => {
      const next = scan()
      // 每次都按当前 DOM 重新判定，**不留闩锁**：早先为了「同一行重渲染别换落点」保留了
      // 旧节点，结果是新轮次开始后仍挂在上一轮的尾巴上——位置会在两处之间来回跳。
      setAnchor((current) => (current.node === next.node && current.kind === next.kind ? current : next))
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return anchor
}

/** 点外面或按 Esc 关闭。 */function useDismiss(open, close, anchorRef, panelRef) {
  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      const target = event.target
      if (panelRef.current?.contains(target) === true) return
      if (anchorRef.current?.contains(target) === true) return
      close()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close, anchorRef, panelRef])
}

/**
 * 余额合计：充值余额 + 赠送余额（平台口径就是这两个钱包相加，余额预警也按合计看）。
 * 按币种分别求和，取有余额的那个币种。
 */
function walletTotal(wallets, bonusWallets) {
  return sumWallets(wallets, bonusWallets)
}

/** 一行「标签 / 值」的明细。 */
function Row({ label, value }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  )
}

/**
 * 唯一一个条目：挂在输入卡上方那一条，再把内容 portal 到当前该在的那一行。
 *
 * 「本轮」是**实时**的：已结算的调用取投影里的精确金额，正在流式输出的那一次
 * 按已吐字符数折算（见 {@link partialChars}）。提供方要到流结束才报 usage，
 * 光等事件落地的话，一次长调用期间这个数会一动不动。
 *
 * 落点由 {@link useAnchorRow} 决定：执行中进「深度求索中」那一行，否则进最后一个轮次尾巴，
 * 两者都没有（或找不到）就留在输入卡上方那一条——任何状态下都有地方显示它。
 *
 * @param props.useProjection - 框架标准工具包：按 key 读宿主投影。
 * @param props.useChat - 框架标准工具包：聊天目标快照（读流式累积）。
 * @param props.useSession - 框架标准工具包：会话状态（running，用于余额刷新节奏）。
 * @param props.useBalance - 本插件注入的余额 observable。
 * @param props.refreshBalance - 立刻拉一次余额（有新调用落地时调用）。
 * @param props.t - 本命名空间的本地化函数。
 */
export function CostPills({ useProjection, useChat, useSession, useBalance, refreshBalance, t }) {
  const cost = useProjection(PROJECTION_KEY)
  const running = useSession((value) => value.running)
  const balance = useBalance((value) => value)
  // 聊天目标缺席时（极简组合）不订阅流式：退化成「只显示已结算金额」。
  // 这里只是选一个函数，不是条件调用 Hook，组件生命周期内选择结果不变。
  const hasChat = typeof useChat === 'function'
  const useChatSafe = hasChat ? useChat : () => 0
  const liveChars = useChatSafe((snapshot) => partialChars(snapshot?.legacy?.partial))
  const liveTurn = useChatSafe((snapshot) => {
    const value = snapshot?.legacy?.partial?.turn
    return typeof value === 'number' ? value : -1
  })

  const schedule = useMemo(
    () => (cost?.schedule === undefined ? null : scheduleFromWire(cost.schedule)),
    [cost?.schedule],
  )
  // 没有时段表就没有倒计时，时钟也不用跳。
  const now = useNow(schedule !== null)
  const [instanceId] = useState(() => {
    instanceSeq += 1
    if (activeInstance === null) activeInstance = instanceSeq
    return instanceSeq
  })
  // 本实例的归属令牌：每个实例一份、永不继承（见 OWNER_ATTR 的说明）
  const [myToken] = useState(() => `dcm-${instanceId}-${Date.now()}`)
  // 全局归属：body 上没有标记时由本实例占上（跨 bundle 也只有一个赢家）；
  // 持有者摘牌后，幸存实例下一次渲染就地接上，不留「整条消失」的空窗。
  const owns = typeof document === 'undefined' || (() => {
    const body = document.body
    let current = body.getAttribute(OWNER_ATTR)
    if (current === null) {
      body.setAttribute(OWNER_ATTR, myToken)
      current = myToken
    }
    return current === myToken
  })()
  const [, forceInstance] = useState(0)
  useEffect(() => {
    const listener = () => forceInstance((value) => value + 1)
    instanceListeners.add(listener)
    return () => {
      instanceListeners.delete(listener)
      if (activeInstance === instanceId) {
        activeInstance = null
        for (const notify of [...instanceListeners]) notify()
      }
      if (typeof document !== 'undefined' && document.body.getAttribute(OWNER_ATTR) === myToken) {
        document.body.removeAttribute(OWNER_ATTR)
      }
    }
  }, [instanceId, myToken])
  const isActiveInstance = activeInstance === null || activeInstance === instanceId
  if (isActiveInstance && activeInstance === null) activeInstance = instanceId

  const anchor = useAnchorRow()
  const [open, setOpen] = useState(false)
  const [compact, setCompact] = useState(0)
  /** 实测可用宽度（px）；null = 没量到，交给 CSS 的保守默认。 */
  const [availableWidth, setAvailableWidth] = useState(null)
  // 那一行实在放不下（连最缩的花费都放不下）时退回自己的槽位，见 shouldUseDock
  const [inDock, setInDock] = useState(false)
  const compactRef = useRef(0)
  compactRef.current = compact
  const partsRef = useRef(null)
  const rootRef = useRef(null)
  const anchorRef = useRef(null)
  const panelRef = useRef(null)
  const position = usePanelPosition(anchorRef, open)
  const close = useCallback(() => setOpen(false), [])
  useDismiss(open, close, anchorRef, panelRef)

  // 余额刷新：有调用落地就刷一次（节流 20 秒），执行中每 30 秒兜底一次。
  // 早先写成 5 秒/10 秒，把账号接口压得太紧——平台自己的用量页都写着数据有几秒到几分钟的延迟，
  // 没必要更密；失败时 store 会按退避重试，并保留上一次的数值。
  // 「在跑」取两个信号之一：会话状态，或聊天目标里确实有流式累积（快照更新会滞后）。
  const busy = running === true || liveTurn !== -1
  const calls = cost?.totals?.calls ?? 0
  const refreshedAt = useRef(0)
  const refreshThrottled = useCallback(() => {
    if (Date.now() - refreshedAt.current < 20_000) return
    refreshedAt.current = Date.now()
    refreshBalance()
  }, [refreshBalance])
  useEffect(() => {
    if (calls === 0) return
    refreshThrottled()
  }, [calls, refreshThrottled])
  useEffect(() => {
    if (!busy) return undefined
    const timer = setInterval(refreshThrottled, 30_000)
    return () => clearInterval(timer)
  }, [busy, refreshThrottled])

  const period = schedule === null ? null : periodAt(now, schedule)
  const nextAt = schedule === null ? null : nextPeriodChangeAt(now, schedule)

  // 落点：**执行中不参与那一行的竞争**，直接落输入卡上方自己的槽位——执行行的内容是
  // 动态的（步骤文字逐字生长、流光动画的矩形随动画脉动），采样式测宽永远追不上它，
  // 绝对定位摆进去迟早压字；自己的槽位是一整条独立行，任何窗口宽度下都不存在竞争。
  // 静态的轮次尾巴行（图标 + 用量 + 时间，渲染完不再变）才按量出来的剩余宽度进行内。
  // portal 目标必须**当前还在文档里**：核心会卸载轮次行（虚拟滚动还会回收行），
  // 往一个已经脱离文档的节点里 portal，React 在提交阶段清理时会抛错并把整棵树卸掉——
  // 表现就是「任务一结束整条就没了」。判断一下，脱钩就回退到自己的槽位，等下一次扫描认新落点。
  const portalNode = !inDock && anchor.kind !== 'running' && anchor.node !== null && anchor.node.isConnected ? anchor.node : null
  const mount = portalNode === null ? 'dock' : anchor.kind

  const currency = cost?.currency ?? 'CNY'
  const symbol = symbolOf(currency)
  const totals = cost?.totals
  const turns = cost?.turns ?? []

  // 诊断（默认关）：开关从投影线值来，关着时这个 effect 只做一次布尔判断。
  const diagnosticsOn = cost?.diagnostics === true
  useEffect(() => {
    if (!diagnosticsOn) return undefined
    reportLayout('anchor')
    const timer = setInterval(() => reportLayout('tick'), 3_000)
    return () => clearInterval(timer)
  }, [diagnosticsOn, anchor.kind, anchor.node])

  // 量「这一行还剩多少宽度」定缩略级别。级别只由剩余宽度决定，不从自己的当前宽度反推——
  // 缩了之后再按缩后的宽度算会来回抖。完整形态下量一次各部分宽度并缓存。
  const lastAnchorNodeRef = useRef(null)
  useEffect(() => {
    const root = rootRef.current
    const anchorNode = anchor.node !== null && anchor.node.isConnected ? anchor.node : null
    // 换行等于换尺子：先把上一行的缩略级别与部件宽度作废再量。这步必须在测量**之前**做——
    // 早先它是另一个排在后面的 effect，会把刚算好的正确级别又清回 0，之后重量的宽度
    // 还带着上一轮的 max-width（量出「刚好放得下」的自洽假象），级别就永远停在 0，
    // 剩下的差额全靠 CSS 挤压兜底——「时段/余额只剩图标」就是这么来的。
    if (lastAnchorNodeRef.current !== anchorNode) {
      lastAnchorNodeRef.current = anchorNode
      compactRef.current = 0
      partsRef.current = null
      setCompact(0)
    }
    // 尺子**永远是落点行**，退回槽位（dock）也不换尺子：槽位那条包在 0 宽的 flex 单元里、
    // 同一行还躺着整张输入卡，拿它当尺子会把输入卡量成「核心内容」（剩余宽度为负），
    // 量出来的可用宽度毫无意义；两把尺子来回切还会让落点在 dock/行之间自激振荡。
    // 执行行不量：那行的核心是动态的（步骤文字、流光动画），量出来的数字一刻就过期，
    // 拿它做判级/落点决定只会来回翻。dock 是兜底落点，天生显示完整形态，不需要量宽。
    const row = anchor.kind === 'running' ? null : anchorNode
    if (root === null || row === null) return undefined
    let lastMeasuredAt = 0
    const measure = (force = false) => {
      // 合并到「一帧一次」：既不会被时钟走动/文字变化量进死循环，也不会因为节流太久
      // 让上一帧的可用宽度继续留着（那会让条目短暂压住核心内容）。
      const now = Date.now()
      if (!force && now - lastMeasuredAt < 16) return
      lastMeasuredAt = now
      // 行内每次都重取**自然宽度**（摘掉 max-width 再量、量完还原，同一帧内不闪）：
      // 1) 上一轮的 max-width 还挂着时，量到的是被压窄的形态，「总宽 ≈ 可用宽」的自洽
      //    假象会把级别锁死在 0；
      // 2) 余额/时段 pill 是晚到的（账号 Remote、投影回放），首次测量时可能还没长全，
      //    拿那时的宽度当门槛会把「该退回槽位」判成「留得住」。
      // dock 里不量部件——槽位那条包在 0 宽单元里，量出来的全是假宽度，
      // 保留行内量到的真值给落点判定用。
      if (!inDock) {
        const clamp = root.style.maxWidth
        if (clamp !== '') root.style.maxWidth = 'none'
        partsRef.current = measureParts(root)
        if (clamp !== '') root.style.maxWidth = clamp
      }
      // 包装层可能是 display:contents（rect 恒为 0）：往上找到真有宽度的那个盒子再量
      const box = measurableBox(row) ?? row
      const rowWidth = box.getBoundingClientRect().width
      // 还没排版完（行宽或自己这组宽度量不到）：什么都不做——不缩略、不改落点。
      // 早先这时会按 0 算，于是开局先缩到只剩「本轮」，要等下一次测量才恢复。
      if (!(rowWidth > 0) || !(partsRef.current?.total > 0)) return
      // 核心内容按**落点行**算：dock 里自己不在这一行上，过滤自身是空操作，核心照常量
      const core = [...box.children].filter((child) => child !== root)
      // 核心内容宽度取「各子元素内容跨度的最大值」，并把整行宽的那种（分隔线之类的装饰）算作 0：
      // 早先只看最后一个子元素，遇到分隔线在末位就会量出整行宽，于是永远判定放不下。
      // 核心内容宽度：容器取「子元素内容跨度」，叶子元素才用自身宽度。
      // 早先对「宽度≈整行」的元素一律当装饰跳过 —— 但轮次尾巴里的动作行是拉伸的 flex 行，
      // 自身宽度 686px（比 680 的行还宽，因为负外边距），于是一整行核心内容全被跳过，
      // 算出核心占用 0、判定「空间很宽」，结果整组压到「用量 …」上（截图里那次重叠就是这么来的）。
      // 现在只有「没有子元素的整行宽叶子」（分隔线之类）才当装饰。
      const coreWidth = core.reduce((widest, child) => {
        const width = contentExtent(child)
        const own = child.getBoundingClientRect().width
        const leafDecoration = child.children.length === 0 && own >= rowWidth - 1
        if (!(width > 0) || leafDecoration) return widest
        return Math.max(widest, width)
      }, 0)
      const parts = partsRef.current
      const gap = parts.gap ?? 0
      // 安全边距：核心内容的跨度是估着量的（图标按钮、内边距都可能算不准）。
      // 4% 实测在轮次尾巴那一行会算宽 → 被 CSS 裁成「波…」；12% 又会缩得太狠（把「会话」也丢了）。
      // 取两者的中间值，并按行宽设下限，避免窄行上余量过小。
      const safety = Math.max(24, rowWidth * 0.07)
      // 右侧保留区（styles.js 里 right:var(--dcm-right-reserve,28px)）也要从可用宽度里扣掉，
      // 否则量出来的可用宽度比实际多 28px，整组会往右压到核心控件上。
      const RIGHT_RESERVE = 28
      const room = rowWidth - coreWidth - gap * 2 - safety - RIGHT_RESERVE
      // 缩略与限宽只在**行内**生效：dock 里永远完整形态（那里没有宽度竞争）。
      // 尺子已经是落点行，这里的 room 对两种落点都是同一把尺，迟滞才成立。
      if (!inDock) {
        setCompact(nextCompactLevel({
          room,
          total: parts.total,
          // 'word' 这一档没有对应的 DOM 元素可量：标签文字大约占整组的 28%，
          // 按比例估一个值，否则估算会以为「丢了 word 没省地方」，从而把级别判得更狠或干脆裁掉。
          parts: { ...parts.parts, word: parts.total * 0.28 },
          current: compactRef.current,
          gap,
        }))
        // 把「实际可用宽度」直接下发给 CSS：不写死 calc(100% - 200px) 这类预留，
        // 换机器、换字号、换缩放都不用改代码。
        // 只在变化超过 1px 时更新：亚像素抖动会引发无休止的重渲染
        const nextWidth = room > 0 ? Math.floor(room) : null
        setAvailableWidth((current) => {
          if (current === nextWidth) return current
          if (current !== null && nextWidth !== null && Math.abs(current - nextWidth) <= 1) return current
          return nextWidth
        })
      }
      setInDock((was) => shouldUseDock({
        room,
        rowWidth,
        // 门槛只由**固定的一组**决定（本轮 + 余额），与缩略级别、与时段都无关。
        // 曾经写成「按当前级别算」，于是形成 门槛 → 级别 → 落点 → 可用宽度 → 门槛 的自激回路，
        // 在边界附近来回跳（用户看到的就是「一会儿在右边、一会儿在输入框上方」）。
        minWidth: minimumRowWidth({
          cost: parts.cost,
          balance: parts.parts.balance,
          gap: parts.gap,
        }) * 0.92,
        wasDock: was,
      }))
    }
    measure(true)
    // 落点刚确定时布局还没稳，前两帧各补量一次（之后靠 RO / resize / 数据变化驱动）
    const settle = [setTimeout(() => measure(true), 32), setTimeout(() => measure(true), 120)]
    // 行内核心内容会**自己变长**：执行中那一行的步骤文字逐字生长、轮次尾巴的动作按钮晚到，
    // 但行宽不变（RO 不响）、事件不落地（cost 不变），量过的可用宽度就一直偏大——
    // 步骤文字长出来就压在它上面。每 500ms 补量一次（与流式字符采样同节奏），跟住核心内容的变化。
    const contentTick = setInterval(() => measure(), 500)
    const onResize = () => measure()
    if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measure()) : null
    observer?.observe(row)
    observer?.observe(root)
    return () => {
      for (const timer of settle) clearTimeout(timer)
      clearInterval(contentTick)
      if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [anchor.node, anchor.kind, inDock, cost, turns.length, balance?.state])


  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null

  // 在飞那一次的字符数按 500ms 采样：逐字更新会让 pill 宽度每秒抖几十次，
  // 叠加「量宽度 → 重渲染」就是持续抖动。调用结算时（cost 变化）仍然是立刻更新。
  const sampledChars = useRef(0)
  const [estChars, setEstChars] = useState(0)
  useEffect(() => {
    if (liveChars === sampledChars.current) return undefined
    const timer = setTimeout(() => {
      sampledChars.current = liveChars
      setEstChars(liveChars)
    }, 500)
    return () => clearTimeout(timer)
  }, [liveChars])

  // 在飞那一次调用的估算金额：提示词用上一次调用的桶代理，输出按已吐字符数折算。
  const inFlightNano = useMemo(
    () => estimateInFlightNano({
      pricing: cost?.pricing,
      previousBuckets: cost?.last?.buckets,
      chars: Math.max(liveChars, estChars),
      model: cost?.last?.key ?? cost?.pricing?.defaultModel ?? undefined,
      period: period ?? 'offPeak',
    }),
    [liveChars, estChars, cost, period],
  )

  // 什么都没有可显示时才不显示：新建的空会话就是这种状态，挂个 ¥0.00 是噪音。
  // 但只要这一轮已经在跑（liveTurn !== -1）就要显示——那一刻还没有已结算的调用，
  // 早先按「calls === 0 就不显示」写会让「刚开始执行」这段时间空着。
  // 投影整个缺席时不走这条：显示「花费 —」更容易发现问题。
  // 会话重放（打开页面/切回会话）期间投影会先推一版「还没有已结算调用」的中间值，
  // 见过调用的会话绝不能因此把整条藏掉——那是开局闪一下就没影的来路之一。
  const sawCallsRef = useRef(false)
  if (totals !== undefined && totals.calls > 0) sawCallsRef.current = true
  if (cost !== undefined && totals.calls === 0 && liveTurn === -1 && !sawCallsRef.current) return null

  // 在飞的调用可能属于一个还没落到 turns 里的新轮次：那样基数必须是 0，不能拿上一轮的金额当基数。
  const settledTurnNano = lastTurn !== null && (liveTurn === -1 || lastTurn.turn === liveTurn) ? lastTurn.nano : 0
  const turnNano = settledTurnNano + inFlightNano
  const turnIsEstimated = inFlightNano > 0

  // 放不下文字标签时的最紧一档：只留「图标 + 数字」，文字全部进 tooltip
  const bareLabels = compact >= DROP_ORDER.indexOf('word') + 1
  // dock 是兜底落点：那一行没有宽度竞争，永远完整形态——不缩略、不限宽。
  // 判定用**实际落点**（mount），不用 inDock 状态：执行中进 dock 时 inDock 未必翻转，
  // 不能带着上一段行内的缩略级别显示。
  const shownCompact = mount === 'dock' ? 0 : compact
  const shownBareLabels = mount === 'dock' ? false : bareLabels

  const sessionText = totals === undefined
    ? t('cost.unavailable')
    : t(shownBareLabels ? 'cost.sessionBare' : 'cost.session', { amount: formatMoney(totals.nano, currency) })
  const turnText = cost === undefined
    ? null
    : t(shownBareLabels ? 'cost.turnBare' : 'cost.turn', {
      label: t('cost.turnNow'),
      amount: turnIsEstimated ? `≈${formatMoney(turnNano, currency)}` : formatMoney(turnNano, currency),
    })
  // 只有一轮时「本轮」就是「会话」，重复显示同一个数没有信息量，省下的宽度留给别处。
  const showSession = totals !== undefined && turns.length > 1
  // 投影整个缺席时没有「本轮」可显示，这时要把「花费 —」这个兜底露出来，
  // 否则整颗 pill 是空的——那才叫「不显示」。
  const showUnavailable = turnText === null

  const periodText = period === null
    ? null
    : t(shownBareLabels ? 'period.bare' : 'period.now', { period: t(period === 'peak' ? 'period.peak' : 'period.offPeak') })
  const nextText = period === null || nextAt === null
    ? null
    : t('period.next', {
      period: t(period === 'peak' ? 'period.offPeak' : 'period.peak'),
      countdown: formatCountdown(nextAt - now),
    })
  const periodTitle = period === null
    ? undefined
    : `${nextText ?? ''}\n${t('period.rule')}`

  const total = balance !== undefined && balance.state !== 'signed-out' && balance.wallets !== undefined
    ? walletTotal(balance.wallets, balance.bonusWallets)
    : null
  // 余额拆成「词 + 数」两段渲染：缩略丢「余额」这个词时只藏词（balanceWord），
  // 数字任何宽度下都留着——这是 README 对用户的承诺，整段一起藏等于把数字也丢了。
  const balanceWord = t('balance.word')
  const balanceAmount = total === null ? null : formatCents(total.cents, total.currency)
  // 非数值态（加载中/取不到）没有可拆的数字，整段显示
  const balanceNotice = (() => {
    // 账号 Remote 没接上（非桌面组合）或未登录时不显示：没有可展示的东西，
    // 也不该占一行说「取不到」。
    if (balance === undefined || balance.available !== true || balance.state === 'signed-out') return null
    if (balance.state === 'loading') return t('balance.loading')
    // 失败但手里还有上一次成功的数值：继续显示它，别让一次网络抖动把余额变成「取不到」
    if (balance.state === 'failed' && balance.stale !== true) return t('balance.failed')
    if (total === null) return t('balance.failed')
    return null
  })()

  const content = (
    <div
      ref={rootRef}
      className={CLASS.root}
      data-cost-meter
      data-placement={mount}
      data-compact={DROP_ORDER.slice(0, shownCompact).join(' ')}
      style={mount === 'dock' || availableWidth === null ? undefined : { maxWidth: `min(${availableWidth}px, 100%)` }}
    >
      <span className={CLASS.anchor} ref={anchorRef}>
        <button
          type="button"
          className={CLASS.pill}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={cost === undefined ? sessionText : `${turnText ?? ''} ${showSession ? sessionText : ''}`.trim()}
          title={cost === undefined
            ? t('cost.hint')
            : `${t('cost.turn', { label: t('cost.turnNow'), amount: turnIsEstimated ? `≈${formatMoney(turnNano, currency)}` : formatMoney(turnNano, currency) })}${showSession ? ` · ${t('cost.session', { amount: formatMoney(totals.nano, currency) })}` : ''}`}
          onClick={() => setOpen((value) => !value)}
        >
          <IconYuanCoinOutlineRegular />
          <span className={CLASS.label}>
            {turnText !== null && (
              <>
                {turnText}
                {showSession && <span className={`${CLASS.sep} dcm_session`} aria-hidden="true">·</span>}
              </>
            )}
            {(showSession || showUnavailable) && <span className="dcm_session">{sessionText}</span>}
          </span>
        </button>
      </span>

      {periodText !== null && (
        <span className={CLASS.pill} title={periodTitle} data-cost-period={period} data-cost-secondary="">
          <IconClockOutlineRegular />
          <span className={CLASS.label}>
            {periodText}
            {nextText !== null && (
              <>
                <span className={CLASS.sep} aria-hidden="true">·</span>
                <span className={CLASS.optional}>{nextText}</span>
              </>
            )}
          </span>
        </span>
      )}

      {(balanceNotice !== null || balanceAmount !== null) && (
        <span
          className={CLASS.pill}
          title={[
            total === null ? null : t('balance.value', { amount: formatCents(total.cents, total.currency) }),
            t('balance.hint'),
            balance?.state === 'failed' && balance.error ? balance.error : null,
          ].filter(Boolean).join(' · ')}
          data-cost-secondary=""
          data-cost-balance=""
        >
          <IconWalletCardOutlineRegular />
          <span className={`${CLASS.label} dcm_balanceLabel`}>
            {balanceNotice !== null
              ? balanceNotice
              : shownBareLabels
                ? t('balance.bare', { amount: balanceAmount })
                : (<><span className="dcm_balanceWord">{balanceWord}</span>{' '}{balanceAmount}</>)}
          </span>
        </span>
      )}

      {open && position !== null && cost !== undefined && createPortal(
        <div
          ref={panelRef}
          className={CLASS.panel}
          role="dialog"
          aria-label={t('dialog.title')}
          style={{ left: position.left, bottom: position.bottom }}
        >
          <DialogBody cost={cost} currency={currency} period={period} nextAt={nextAt} now={now} balance={balance} t={t} />
        </div>,
        document.body,
      )}
    </div>
  )

  // 找到落点就 portal 进去（执行中：与「深度求索中」同排靠右；已结束：排在「用量 … / 时间」之后）；
  // 没找到就留在自己的槽位里——输入卡上方那一条，始终可见。
  // 非在职实例只挂一个空的占位，绝不出内容（避免出现上下两份）
  if (!isActiveInstance || !owns) return null
  return portalNode === null ? content : createPortal(content, portalNode)
}

/** 明细面板。所有数字都来自投影线值，界面不自己算钱。 */
function DialogBody({ cost, currency, period, nextAt, now, balance, t }) {
  const totals = cost.totals
  const buckets = totals.buckets
  const money = (nano) => formatMoney(nano, currency)
  const bucketRow = (label, tokens, nano) => (
    <Row label={label} value={`${formatTokens(tokens)} tok · ${money(nano)}`} />
  )
  const byBucket = totals.nanoByBucket ?? { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0 }

  return (
    <>
      <div className={CLASS.title}>
        <span className={CLASS.titleLabel}>
          <IconYuanCoinOutlineRegular />
          {t('dialog.title')}
        </span>
        <span className={CLASS.titleValue}>{money(totals.nano)}</span>
      </div>
      <div className={CLASS.rule} aria-hidden="true" />

      <dl className={CLASS.details}>
        <Row label={t('dialog.period')} value={period === null ? t('dialog.periodUnknown') : t(period === 'peak' ? 'period.peakFull' : 'period.offPeakHalf')} />
        {nextAt !== null && <Row label={t('dialog.switchIn')} value={formatCountdown(nextAt - now)} />}
        {cost.last !== null && (
          <Row
            label={t('dialog.lastCall')}
            value={`${money(cost.last.nano)} · ${formatTokens(cost.last.tokens)} tok${cost.last.priced ? '' : ` · ${t('dialog.unpricedTag')}`}`}
          />
        )}
        <Row label={t('dialog.peakTotal')} value={`${money(cost.periods.peak.nano)} · ${formatTokens(cost.periods.peak.tokens)} tok`} />
        <Row label={t('dialog.offPeakTotal')} value={`${money(cost.periods.offPeak.nano)} · ${formatTokens(cost.periods.offPeak.tokens)} tok`} />
        <Row label={t('dialog.calls')} value={String(totals.calls)} />
      </dl>

      <div className={CLASS.section}>{t('dialog.buckets')}</div>
      <dl className={CLASS.details}>
        {bucketRow(t('bucket.cacheHit'), buckets.cacheHit, byBucket.cacheHit)}
        {bucketRow(t('bucket.cacheMiss'), buckets.cacheMiss, byBucket.cacheMiss)}
        {buckets.cacheWrite > 0 && bucketRow(t('bucket.cacheWrite'), buckets.cacheWrite, byBucket.cacheWrite)}
        {bucketRow(t('bucket.output'), buckets.output, byBucket.output)}
      </dl>

      {cost.models.length > 0 && (
        <>
          <div className={CLASS.section}>{t('dialog.models')}</div>
          <dl className={CLASS.details}>
            {cost.models.map((model) => (
              <Row
                key={model.key}
                label={model.label ?? model.key}
                value={`${formatTokens(model.tokens)} tok · ${model.priced ? money(model.nano) : t('dialog.unpricedTag')}`}
              />
            ))}
          </dl>
        </>
      )}

      {totals.unpricedCalls > 0 && (
        <div className={`${CLASS.note} ${CLASS.warn}`}>
          {t('dialog.unpriced', { calls: totals.unpricedCalls, tokens: formatTokens(totals.unpricedTokens) })}
        </div>
      )}

      {balance?.state === 'ready' && balance.wallets.length + balance.bonusWallets.length > 0 && (
        <>
          <div className={CLASS.section}>{t('dialog.balance')}</div>
          <dl className={CLASS.details}>
            {(() => {
              const sum = (list) => list.reduce((total, wallet) => total + (parseAmountToCents(wallet?.balance) ?? 0), 0)
              const currency = balance.wallets[0]?.currency ?? balance.bonusWallets[0]?.currency ?? 'CNY'
              const topUp = sum(balance.wallets)
              const bonus = sum(balance.bonusWallets)
              return (
                <>
                  <Row label={t('dialog.wallet')} value={formatCents(topUp, currency)} />
                  <Row label={t('dialog.bonus')} value={formatCents(bonus, currency)} />
                  <Row label={t('dialog.balanceTotal')} value={formatCents(topUp + bonus, currency)} />
                </>
              )
            })()}
          </dl>
        </>
      )}

      <div className={CLASS.note}>
        {t('dialog.source')} · <a href={PRICING_URL} target="_blank" rel="noreferrer">{t('dialog.sourceLink')}</a>
      </div>
    </>
  )
}

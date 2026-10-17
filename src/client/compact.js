/**
 * 缩略显示：这一行放不下时按固定顺序丢信息，而不是重叠、换行或裁一半。
 *
 * 判据是**容器实际剩余宽度**，不是视口宽度：聊天列有 `--dsh-chat-content-width` 上限、
 * 两侧还有 clearance，视口宽 1000px 时那一行可能只有 600px。所以由组件量出
 * 「这一行多宽 / 核心内容多宽 / 我这一组多宽」，交给下面这个纯函数定级别。
 *
 * 丢的顺序（先丢最不重要的）：会话总额 → 切换倒计时 → 余额 → 时段。
 * 全丢完还剩「本轮 ≈¥x」——那几个数里它是主角，任何宽度下都留。
 *
 * 纯函数在这里、量宽度在组件里：这一层可单测，不依赖 DOM。
 */

/**
 * 逐级丢弃的顺序，索引 0 对应等级 1。**逐级丢的是「词的重量」，不是整块数字**：
 *
 *   1. countdown    切换倒计时——只是提示，不是钱数
 *   2. session      会话总额——明细里一直有
 *   3. balanceLabel 「余额」这个词——旁边就是银行卡图标，金额不会认错
 *   4. period       整个时段 pill——最后才丢
 *
 * 余额的**数字**在任何宽度下都保留（用户点名要看），要丢只丢它的标签。
 */
export const DROP_ORDER = ['countdown', 'session', 'balanceLabel', 'word', 'period']

/**
 * 相邻 pill 间距的**兜底值**，只在量不到计算样式时用。
 * 正常路径是 {@link measureParts} 从 `.dcm_root` 的 `column-gap` 现读——
 * 写死常量在不同字号/缩放下会算错。
 */
export const FALLBACK_GAP = 10

/** 允许丢到第几级：**时段那一颗永远不丢**（DROP_ORDER 的最后一项够不着），
 *  再放不下就交给 {@link shouldUseDock} 退回输入卡上方那一条，不在这一行硬挤。 */
export const MAX_DROP_LEVEL = DROP_ORDER.length - 1

/** 一行里最少要保住的那几样（本轮 + 时段 + 余额）的宽度，用来决定「要不要退回槽位」。 */
export function minimumRowWidth({ cost, period, balance, gap = FALLBACK_GAP }) {
  const sum = (Number(cost) || 0) + (Number(period) || 0) + (Number(balance) || 0)
  return sum <= 0 ? 0 : sum + gap * 2
}

/**
 * 丢到某一级后**真实**还剩多宽。
 *
 * countdown / session / word 都嵌在各自的 pill 里（span），丢掉它们**不省间距**；
 * 只有丢整颗 pill（period）才会连一份间距一起省——但 MAX_DROP_LEVEL 够不到那一级。
 * 早先每级都虚减一份 gap，把剩余宽度系统性低估：判出来的级别偏松，
 * 真实渲染宽度比判级时以为的宽，差额由 CSS 挤压兜底——「时段/余额被挤到只剩图标」
 * 就是这个记账误差叠出来的。
 *
 * @param level - 丢到第几级（0 = 完整形态）。
 * @param parts - 各项的**自然**宽度。
 * @param total - 完整形态总宽（含间距）。
 */
function remainingWidthAt(level, parts, total) {
  let cut = 0
  for (let i = 0; i < level && i < DROP_ORDER.length; i += 1) cut += Number(parts?.[DROP_ORDER[i]]) || 0
  return total - cut
}

/**
 * 定缩略级别。
 * @param args.room - 可用宽度（容器宽 - 核心内容宽 - 预留间距），单位 px。
 * @param args.total - 完整形态下本组的总宽（含间距），必须是**未受 max-width 压制**时量到的。
 * @param args.parts - 各项的宽度：`{ session, countdown, balance }`，缺省按 0。
 * @returns 0（完整）到 {@link MAX_DROP_LEVEL}（本轮 + 时段 + 余额数字的最紧形态）。
 */
export function pickCompactLevel({ room, total, parts, gap = FALLBACK_GAP }) {
  if (!Number.isFinite(room) || !Number.isFinite(total)) return 0
  if (remainingWidthAt(0, parts, total) <= room) return 0
  // 最多丢到「本轮 + 时段 + 余额数字」为止：时段与余额数字都是用户点名要看的。
  // 再放不下就不硬挤了，交给 shouldUseDock 退回输入卡上方那一条（那里宽度够）。
  for (let level = 1; level <= MAX_DROP_LEVEL; level += 1) {
    if (remainingWidthAt(level, parts, total) <= room) return level
  }
  return MAX_DROP_LEVEL
}

/**
 * 连花费那一颗都放不下的判据：按**量出来的花费 pill 宽度**再加一成余量。
 * 不写死 px——字号、缩放、语言都会改变这个宽度。
 */
export function dockFallbackThreshold(costWidth) {
  if (!Number.isFinite(costWidth) || costWidth <= 0) return 0
  return costWidth * 1.1
}
/**
 * 要不要放弃「挤进那一行」、退回输入卡上方自己那一条？
 *
 * 只按**剩余宽度**判：那一行宽度减去核心内容的实际跨度。不设「行宽小于 N 就退」这类绝对阈值——
 * 聊天列本身有 `--dsh-chat-content-width` 上限（本机实测 680px），一旦把阈值定在它之上，
 * 所有场景都会被判成放不下（这是实测踩出来的）。
 *
 * 那一行是绝对定位摆进去的，空间不够就会压住核心内容，所以宁可退回槽位。
 * 切回去时留 60px 余量，避免窗口拖动时来回抖；一个数都量不到时保持上一轮判断。
 *
 * @param args.room - 那一行扣掉核心内容后的剩余宽度。
 * @param args.minWidth - 只剩花费一颗时的宽度（量出来的）。
 * @param args.wasDock - 上一轮是否已经退回。
 */
export function shouldUseDock({ room, minWidth, wasDock, slack, rowWidth }) {
  // 宽度量不到（首帧、`display:contents` 包装层、容器还没布局）时保持上一轮判断：
  // 早先这里把 0 当成「没空间」，于是刚开任务时就锁死在槽位上再也回不来。
  if (Number.isFinite(rowWidth) && rowWidth <= 0) return wasDock === true
  if (!Number.isFinite(room)) return wasDock === true
  const need = Number.isFinite(minWidth) ? minWidth : 0
  // 切回去的余量按需求宽度的两成算，同样不写死 px：字号放大时余量同步放大
  const band = Number.isFinite(slack) ? slack : Math.max(24, need * 0.2)
  return wasDock === true ? room < need + band : room < need
}

/**
 * 放宽缩略级别时要求的余量：取完整形态宽度的一成（至少 24px）。
 * 按比例而不是写死 px——字号、缩放变了，这个余量要跟着变。
 */
export function relaxSlack(total) {
  return Number.isFinite(total) && total > 0 ? Math.max(24, total * 0.1) : 24
}

/**
 * 带迟滞的级别推进：**变紧立刻生效，放宽要留余量**。
 *
 * 为什么需要：金额数字一直在长（¥0.0917 → ¥0.1024），每帧重算会让级别在 0/1 之间来回跳，
 * 表现就是「一会儿正常、一会儿只剩本轮」。这里只在自己确有余量时才放宽。
 *
 * @param args.room - 剩余宽度。
 * @param args.total - 完整形态总宽。
 * @param args.parts - 各部分宽度。
 * @param args.current - 当前级别。
 * @returns 下一级别。
 */
export function nextCompactLevel({ room, total, parts, current, gap = FALLBACK_GAP }) {
  const target = pickCompactLevel({ room, total, parts, gap })
  if (target >= current) return target
  // 想放宽：拿「少一份余量」再算一次，仍能停在 target 才算真有富余
  const strict = pickCompactLevel({ room: room - relaxSlack(total), total, parts, gap })
  return strict <= target ? target : current
}

/**
 * 找一个**真有宽度**的盒子：从自身往上找，返回第一个 rect 宽度为正的元素。
 *
 * 为什么需要：包装层常常是 `display:contents`，它自己不生成盒子、rect 恒为 0，
 * 而里面的内容有真实宽度。拿它当尺子会得出「这一行宽度为 0」→ 永远判定放不下 →
 * 落点锁死在输入框上方（实测踩到过）。找不到就返回 null，调用方按「量不到」处理。
 *
 * @param element - 起始元素。
 * @param maxDepth - 最多往上找几层。
 */
export function measurableBox(element, maxDepth = 6) {
  let node = element
  for (let depth = 0; node !== null && node !== undefined && depth < maxDepth; depth += 1) {
    if (typeof node.getBoundingClientRect === 'function') {
      const rect = node.getBoundingClientRect()
      if (Number.isFinite(rect?.width) && rect.width > 0) return node
    }
    node = node.parentElement ?? null
  }
  return null
}

/**
 * 量一个元素**内容**的横向跨度（它自己可能是拉伸到整行的 flex 行，rect 宽度不代表内容宽度）。
 * 取子元素 left/right 的并集；没有可见子元素时退回自身的 rect 宽度。
 * @param element - 要量的元素。
 * @returns 内容宽度（px）。
 */
export function contentExtent(element) {
  if (element === null || element === undefined) return 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const child of element.children) {
    const rect = child.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    min = Math.min(min, rect.left)
    max = Math.max(max, rect.right)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const own = element.getBoundingClientRect()
    return Number.isFinite(own.width) ? own.width : 0
  }
  return Math.max(0, max - min)
}

/**
 * 量本组各部分的宽度（用于 {@link pickCompactLevel}）。
 * @param root - 本插件的根元素。
 * @returns `{ total, parts }`。
 */
export function measureParts(root) {
  const width = (element) => {
    if (element === null) return 0
    const rect = element.getBoundingClientRect()
    return Number.isFinite(rect.width) ? rect.width : 0
  }
  const sum = (selector) => [...root.querySelectorAll(selector)]
    .reduce((total, element) => total + width(element), 0)
  const pills = [...root.children]
  // 间距现读计算样式：写死常量在别的字号/缩放下会算错
  const computed = typeof getComputedStyle === 'function' ? getComputedStyle(root) : null
  const rawGap = computed === null ? '' : (computed.columnGap === 'normal' ? computed.gap : computed.columnGap)
  const parsedGap = Number.parseFloat(String(rawGap))
  const gap = Number.isFinite(parsedGap) && parsedGap >= 0 ? parsedGap : FALLBACK_GAP
  const gapTotal = Math.max(0, pills.length - 1) * gap
  const parts = {
    session: sum('.dcm_session'),
    countdown: sum('.dcm_optional'),
    balance: width(root.querySelector('[data-cost-balance]')),
    balanceLabel: width(root.querySelector('.dcm_balanceWord')),
    period: width(root.querySelector('[data-cost-period]')),
  }
  const total = pills.reduce((sum2, pill) => sum2 + width(pill), 0) + gapTotal
  // 花费那一颗（含它的锚点）的宽度：兜底判据与最缩形态都用它，别再写死数字
  const costPill = root.querySelector('.dcm_anchor')
  return { total, parts, gap, cost: width(costPill) }
}

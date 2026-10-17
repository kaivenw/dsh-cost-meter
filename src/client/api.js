/**
 * 客户端与宿主之间的约定，以及界面上几处共享常量。
 *
 * 这里没有 HTTP 路由：金额走会话投影 `costMeter`（宿主折叠、客户端 `useProjection` 读），
 * 余额走账号 Remote（`ctx.remote.account.getBalance`）。两条都是官方通道，插件不自己开洞。
 */

/** 插件 id：slot 条目 id、模块 id、配置条目 id 三处必须一致。 */
export const ID = 'dsh-cost-meter'

/** 本地化命名空间。 */
export const NS = 'dsh-cost-meter'

/** 宿主半侧注册的投影键，与 src/host/cost-fold.js 的 PROJECTION_KEY 必须一致。 */
export const PROJECTION_KEY = 'costMeter'

/** 余额轮询间隔。额度变化只发生在计费之后，一分钟一次足够，也不去打扰 Platform。 */
export const BALANCE_POLL_MS = 60_000

/** 界面上时钟的刷新间隔：时段切换要准，倒计时按分钟显示，一秒一跳够用也不贵。 */
export const CLOCK_TICK_MS = 1_000

/**
 * 客户端身份，随每次账号调用现取（语言与偏移会变）。
 * Platform 只用它做归因，不参与鉴权。
 * @param language - 当前界面语言，如 `zh-CN` / `en-US`。
 */
export function accountClientMetadata(language) {
  const boot = typeof globalThis === 'object' ? globalThis.__DSH_BOOT__ : undefined
  const version = typeof boot?.version === 'string' && boot.version !== '' ? boot.version : '0.2.0-rc.2'
  return {
    version,
    locale: typeof language === 'string' && language !== '' ? language : 'zh-CN',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  }
}

/**
 * 钱包余额串 → **整数分**。Platform 允许 `0E-16`、`5.0000000000000000` 这类写法。
 *
 * 为什么不用浮点：`93.06 + 196.60` 在 double 里是 `289.65999999999997`，平台口径是截断到分，
 * 于是会少显示一分钱。整数分没有这个问题，也正好对上平台自己的 roundDown 显示规则。
 * @returns 整数分；解析不出来时 null（宁可不显示，也不显示 0）。
 */
export function parseAmountToCents(text) {
  const matched = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(String(text ?? ''))
  if (matched === null || (matched[2] === '' && (matched[3] ?? '') === '')) return null
  const sign = matched[1] === '-' ? -1 : 1
  const whole = matched[2] === '' ? 0 : Number(matched[2])
  const fraction = (matched[3] ?? '').padEnd(2, '0').slice(0, 2)
  const cents = whole * 100 + Number(fraction)
  const exponent = matched[4] === undefined ? 0 : Number(matched[4])
  const scaled = exponent === 0 ? cents : cents * 10 ** exponent
  return Number.isFinite(scaled) ? sign * Math.round(scaled) : null
}

/**
 * 把「充值余额 + 赠送余额」按币种分别求和，返回主币种的合计。
 * 平台口径就是这两个钱包相加（充值 + 赠送），余额预警与展示都按合计看。
 * @param wallets - `AccountWallet[]`（充值）。
 * @param bonusWallets - `AccountWallet[]`（赠送）。
 * @returns `{ currency, cents, topUpCents, bonusCents }`；一个都解析不出来时 null。
 */
export function sumWallets(wallets, bonusWallets) {
  const totals = new Map()
  const add = (list, field) => {
    for (const wallet of Array.isArray(list) ? list : []) {
      const cents = parseAmountToCents(wallet?.balance)
      if (cents === null) continue
      const currency = typeof wallet?.currency === 'string' && wallet.currency !== '' ? wallet.currency : 'CNY'
      const entry = totals.get(currency) ?? { currency, cents: 0, topUpCents: 0, bonusCents: 0 }
      entry[field] += cents
      entry.cents += cents
      totals.set(currency, entry)
    }
  }
  add(wallets, 'topUpCents')
  add(bonusWallets, 'bonusCents')
  if (totals.size === 0) return null
  // 主币种：有余额的那个优先，其次第一个
  const entries = [...totals.values()]
  return entries.find((entry) => entry.cents !== 0) ?? entries[0]
}

/**
 * 整数分 → 显示串，按平台的截断规则（不足一分显示 `<¥0.01`，零显示 `¥0.00`）。
 * @param cents - 整数分。
 * @param currency - 货币代码。
 */
export function formatCents(cents, currency) {
  const symbol = currencySymbolOf(currency)
  if (cents === 0) return `${symbol}0.00`
  const negative = cents < 0
  const absolute = Math.abs(cents)
  // 一律两位小数（平台也是这个口径：¥5.00，不是 ¥5）
  const text = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
  const grouped = text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${symbol}${grouped}`
}

/** 货币符号。 */
function currencySymbolOf(currency) {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

/** 界面文案里的货币符号。 */
export function symbolOf(currency) {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return `${currency} `
}

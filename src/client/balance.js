/**
 * 账户余额的取值器：宿主 Remote（`ctx.remote.account.getBalance`）→ 一份可订阅快照。
 *
 * 为什么放在 `apply` 里而不是组件里：组件拿不到 `ctx.remote`（客户端 bundle 只有
 * seed 表里的 9 个模块，没有插件上下文）。所以按 slot 的 `inject` 约定，把
 * `{ getSnapshot, subscribe }` 这个 observable 交给渲染器，组件侧拿到的是
 * `useBalance(selector)` 这个选择器 Hook（渲染器用 useSyncExternalStore 绑定）。
 *
 * `getSnapshot` 必须返回**引用稳定**的快照：不变时返回同一个对象，
 * 否则 useSyncExternalStore 会认为每次都变了，渲染成死循环。
 *
 * 账号 Remote 是**可选**依赖：它属于桌面端的账号插件，别的组合里可能整块不存在。
 * 那时余额 pill 显示「取不到」，而花费与时段两个 pill 照常工作——不因为一个可选
 * 依赖缺席就把整个插件卡住不加载。
 *
 * 失败处理的三条约定（余额是网络数，不能因为一次抖动就长期显示「取不到」）：
 *   1. 失败后按退避重试（5s → 15s → 60s），成功了就回到 60s 常规轮询；
 *   2. 失败时**保留最后一次成功的数值**（`stale: true`），界面继续显示它并标注「更新失败」；
 *   3. 错误码留在快照里（`error`），界面挂到 title 上——出问题时能一眼看出是哪种失败。
 */

import { BALANCE_POLL_MS, accountClientMetadata } from './api.js'

/**
 * 未取到值时的快照。引用固定，避免每次刷新都触发订阅者重渲染。
 * `available` 表示账号 Remote 是否已经接上：没接上时界面不显示余额 pill，
 * 而不是显示一个永远转不完的「加载中」。
 */
const LOADING = { state: 'loading', available: false, wallets: [], bonusWallets: [], error: null, stale: false, updatedAt: 0 }

/** 失败后的退避重试间隔（毫秒），用完之后回到常规轮询。 */
const RETRY_BACKOFF_MS = [5_000, 15_000, 60_000]

/**
 * 建立余额存储。
 * @param ctx - 客户端插件上下文（需已注入 `remote`）。
 * @returns `{ source, refresh, attachAccount, disable, dispose }`。
 */
export function createBalanceStore(ctx) {
  let snapshot = LOADING
  let account = undefined
  let disabled = false
  const listeners = new Set()
  let inflight = null
  let failures = 0
  let retryTimer = null

  const source = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  const publish = (next) => {
    if (next.state === snapshot.state
      && next.available === snapshot.available
      && next.error === snapshot.error
      && next.stale === snapshot.stale
      && next.wallets === snapshot.wallets
      && next.bonusWallets === snapshot.bonusWallets) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  /** 失败：保留上一次成功的数值（stale），并按退避安排下一次重试。 */
  const fail = (error) => {
    failures += 1
    const keep = snapshot.state === 'ready'
    publish({
      state: 'failed',
      available: true,
      // 有旧值就继续用它显示，只把它标成「过期」
      wallets: keep ? snapshot.wallets : [],
      bonusWallets: keep ? snapshot.bonusWallets : [],
      error,
      stale: keep,
      updatedAt: keep ? snapshot.updatedAt : Date.now(),
    })
    if (disabled || retryTimer !== null) return
    const wait = RETRY_BACKOFF_MS[Math.min(failures - 1, RETRY_BACKOFF_MS.length - 1)]
    retryTimer = setTimeout(() => {
      retryTimer = null
      refresh()
    }, wait)
  }

  const refresh = () => {
    if (disabled) return Promise.resolve()
    if (inflight !== null) return inflight
    // 账号 Remote 还没就位：保持「加载中」，不去报一个假的失败。
    if (account === undefined || typeof account.getBalance !== 'function') {
      publish(LOADING)
      return Promise.resolve()
    }
    inflight = (async () => {
      try {
        const language = ctx.locale.getSnapshot().active
        const result = await account.getBalance(accountClientMetadata(language))
        if (result === undefined || result === null || result.ok !== true) {
          fail(result?.error?.code ?? 'unknown')
          return
        }
        const value = result.value
        // 未登录 / 查询期间账号变了：Platform 侧返回 null。这不是错误，是「没有可显示的东西」。
        if (value === null || value === undefined) {
          publish({ state: 'signed-out', available: true, wallets: [], bonusWallets: [], error: null, updatedAt: Date.now() })
          return
        }
        failures = 0
        publish({
          state: 'ready',
          available: true,
          wallets: Array.isArray(value.value) ? value.value : [],
          bonusWallets: Array.isArray(value.bonusWallets) ? value.bonusWallets : [],
          error: null,
          stale: false,
          updatedAt: Date.now(),
        })
      } catch (error) {
        fail(String(error?.message ?? error))
      } finally {
        inflight = null
      }
    })()
    return inflight
  }

  const timer = setInterval(refresh, BALANCE_POLL_MS)

  return {
    source,
    refresh,
    /** 账号 Remote 到位后接上（由 `ctx.inject(['remote.account'], …)` 调用）。 */
    attachAccount: (value) => {
      account = value
      publish({ ...snapshot, available: true })
      refresh()
    },
    dispose: () => {
      disabled = true
      clearInterval(timer)
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
      listeners.clear()
    },
  }
}

/**
 * 客户端半侧入口：把三个 pill 挂进**轮次尾巴**那一行。
 *
 * 挂载点是聊天目标自己的 `conversation.chat.turnTail`——「已完成轮次动作行之前的有序贡献」。
 * 该容器是 column 布局，本包在 styles.js 里把它改成可换行的行布局，并用 `order` 把自己的
 * 条目排到动作行（复制 / 点赞 / 用量 / 时间）之后，于是这几个数正落在时间右边、与那一行同排。
 *
 * 只挂**最新一轮**的尾巴：历史轮次各有自己的尾巴，若每轮都渲染，会话总额、时段、余额
 * 会在整篇对话里重复几十遍。判据是 `ChatSnapshot.timeline.turnOrder` 的最后一个轮次号。
 *
 * 这个文件是**构建入口**，产物是仓根的 `client.js`（`window.__ModuleLoader__.load`
 * 信封 + esbuild 打好的 factory），由 `scripts/build-client.mjs` 拼装。
 * 运行时只能 require 平台 seed 表里的 9 个模块；`react` 与
 * `@deepseek-ai/dsh-client-ui-primitives` 是其中两项，本包自有的模块被 esbuild 打进 bundle。
 */

import { ID, NS } from './api.js'
import { createBalanceStore } from './balance.js'
import { en, zh } from './dictionary.js'
import { CostPills } from './pills.jsx'
import { installStyles } from './styles.js'

export const name = ID

/**
 * 依赖：slot 注册表、本地化、Remote 根。
 * `remote.account` 不写在这里而是可选注入（见 apply）——它是桌面端账号插件的命名空间，
 * 缺席时只影响余额 pill，不该把花费与时段一起拖住不加载。
 */
export const inject = ['slots', 'locale', 'remote']


/**
 * 挂载。
 * @param ctx - 客户端插件上下文。
 */
export function apply(ctx) {
  if (typeof document !== 'undefined') installStyles(document)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${ID}: dictionaries`)

  const balance = createBalanceStore(ctx)
  ctx.effect(() => () => balance.dispose(), `${ID}: balance store`)
  // 账号 Remote 可选：到位就接上并立刻拉一次；不到位的组合里不显示余额 pill。
  ctx.inject(['remote.account'], (accountCtx) => {
    balance.attachAccount(accountCtx.remote.account)
  })

  // 只挂一处：输入卡上方那一条（`conversation.input.dock`）。组件自己把内容 portal 到
  // 当前该在的那一行——执行中进「深度求索中」，否则进最后一个轮次尾巴；两处都找不到时
  // 就留在本槽位，于是任何状态下都看得见，也不会重复出现。
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: `${ID}-live`,
    order: 30,
    locale: NS,
    inject: () => ({
      hooks: { balance: balance.source },
      refreshBalance: balance.refresh,
    }),
  }, CostPills))
}

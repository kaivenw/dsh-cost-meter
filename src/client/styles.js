/**
 * 样式。刻意贴着 `dsh-client-ui-chat` 的 StatsPills / stat-dialog 写：
 * 同一行里已经有那两个 pill，视觉语言不一致会像贴上去的补丁。
 * 颜色全走 `--dsw-*` 设计 token，浅色/深色主题都不用另写一套。
 */

export const CLASS = {
  root: 'dcm_root',
  anchor: 'dcm_anchor',
  pill: 'dcm_pill',
  label: 'dcm_label',
  sep: 'dcm_sep',
  optional: 'dcm_optional',
  panel: 'dcm_panel',
  title: 'dcm_title',
  titleLabel: 'dcm_titleLabel',
  titleValue: 'dcm_titleValue',
  rule: 'dcm_rule',
  details: 'dcm_details',
  route: 'dcm_route',
  section: 'dcm_section',
  note: 'dcm_note',
  warn: 'dcm_warn',
}

export const CSS = `
/* 两个落点容器只加「定位坐标系」，**不改它们自己的布局**（不动 flex-direction / order /
   flex / margin）：改了就会把核心那几行推偏——上一版就是这么翻车的。
   条目的垂直位置按「容器最后一个子元素」对齐：执行中那一行最后是流光文字，尾巴最后是动作行
   （用量 / 时间），所以两个都用 bottom 贴底，而不是整个容器垂直居中——尾巴里可能还有
   别的贡献（比如交付物卡片），居中的话会飘到卡片上去。 */
div[data-chat-running]:has(> [data-cost-meter]),
div[data-turn-tail]:has(> [data-cost-meter]){position:relative}
div[data-chat-running] > [data-cost-meter]{
  /* 右侧留保留区：动作行右端可能有核心自己的控件（▾ 等），贴 right:0 会被压住 */
  position:absolute;right:var(--dcm-right-reserve,28px);bottom:0;
  /* 还没量到之前用百分比兜着（绝不写死 px），量到后由组件下发实测的 max-width */
  max-width:60%;overflow:hidden}
div[data-turn-tail] > [data-cost-meter]{
  position:absolute;right:var(--dcm-right-reserve,28px);bottom:3px;
  /* 还没量到之前用百分比兜着（绝不写死 px），量到后由组件下发实测的 max-width */
  max-width:60%;overflow:hidden}

/* 放不下就缩略，绝不重叠、绝不裁一半。级别由组件量出来的**容器剩余宽度**决定
   （见 src/client/compact.js），这里只按标记把对应的部分藏掉：
   丢的顺序是 会话总额 → 切换倒计时 → 余额 → 时段，最后只剩「本轮 ≈¥x」。
   用容器宽度而不是视口宽度：聊天列有 max-width 与两侧 clearance，两者差得很远。 */
.dcm_root[data-compact~="session"] .dcm_session{display:none}
.dcm_root[data-compact~="countdown"] .dcm_optional{display:none}
/* 只藏「余额」这个词、数字留着：词与数是两个 span（见 pills.jsx 的余额 pill） */
.dcm_root[data-compact~="balanceLabel"] .dcm_balanceWord{display:none}
.dcm_root[data-compact~="period"] > [data-cost-period]{display:none}

/* 兜底：没找到那一行时退回输入卡上方那一条（conversation.input.dock），居中显示。 */
.dcm_root[data-placement="dock"]{justify-content:center;padding:0 2px}

.dcm_root{box-sizing:border-box;min-width:0;max-width:100%;display:flex;align-items:center;gap:10px;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}
/* 一颗都不换行；空间不够时 flex 会先压时段与余额（标签走省略号），花费那颗最小。
   容器本身另有 max-width + overflow:hidden，绝不会把核心那几行顶出去。 */
.dcm_root > .dcm_anchor{flex:none}
.dcm_root > .dcm_pill{flex:0 1 auto;min-width:0}
.dcm_root > .dcm_pill[data-cost-secondary]{flex-shrink:6}
.dcm_anchor{position:relative;display:inline-flex;min-width:0}
.dcm_pill{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;border-radius:999px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}
.dcm_pill svg{flex:none;width:14px;height:14px}
.dcm_label{text-overflow:ellipsis;min-width:0;overflow:hidden}
.dcm_sep{color:var(--dsw-alias-separator-primary);margin:0 6px}
button.dcm_pill{cursor:pointer}
button.dcm_pill:hover,button.dcm_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dcm_panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu,var(--dsw-alias-bg-base));width:max-content;min-width:min(320px,100vw - 24px);max-width:min(460px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:16px;font-size:12px;line-height:18px;position:fixed}
.dcm_title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}
.dcm_titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}
.dcm_titleLabel svg{flex:none;width:14px;height:14px}
.dcm_titleValue{font-variant-numeric:tabular-nums}
.dcm_rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}
.dcm_details{color:var(--dsw-alias-label-tertiary);grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;display:grid}
.dcm_details dt,.dcm_details dd{min-width:0;margin:0}
.dcm_details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right}
.dcm_route{overflow-wrap:anywhere}
.dcm_section{color:var(--dsw-alias-label-tertiary);margin:12px 0 6px;font-weight:500}
.dcm_note{color:var(--dsw-alias-label-tertiary);margin-top:10px;font-size:11px;line-height:16px}
.dcm_warn{color:var(--dsw-alias-label-warning,var(--dsw-alias-label-secondary))}
`

/** 注入样式。重复加载（客户端 HMR）时就地改写内容，而不是提前返回——
 *  提前返回会让改过的 CSS 只在整页刷新后才生效，HMR 下看到的是旧样式。 */
export function installStyles(document_) {
  const marker = 'dsh-cost-meter'
  const existing = document_.querySelector(`style[data-plugin-css="${marker}"]`)
  if (existing !== null) {
    if (existing.textContent !== CSS) existing.textContent = CSS
    return
  }
  const tag = document_.createElement('style')
  tag.dataset.plugin = marker
  tag.dataset.pluginCss = marker
  tag.textContent = CSS
  document_.head.appendChild(tag)
}

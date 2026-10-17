// Generated from src/client by `pnpm run build` (scripts/build-client.mjs). Do not edit by hand.
window.__ModuleLoader__.load({
  id: 'dsh-cost-meter',
  factory: (require) => {
const module = { exports: {} }
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/api.js
var ID = "dsh-cost-meter";
var NS = "dsh-cost-meter";
var PROJECTION_KEY = "costMeter";
var BALANCE_POLL_MS = 6e4;
var CLOCK_TICK_MS = 1e3;
function accountClientMetadata(language) {
  const boot = typeof globalThis === "object" ? globalThis.__DSH_BOOT__ : void 0;
  const version = typeof boot?.version === "string" && boot.version !== "" ? boot.version : "0.2.0-rc.2";
  return {
    version,
    locale: typeof language === "string" && language !== "" ? language : "zh-CN",
    timezoneOffsetSeconds: -(/* @__PURE__ */ new Date()).getTimezoneOffset() * 60
  };
}
function parseAmountToCents(text) {
  const matched = /^\s*([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?\s*$/.exec(String(text ?? ""));
  if (matched === null || matched[2] === "" && (matched[3] ?? "") === "") return null;
  const sign = matched[1] === "-" ? -1 : 1;
  const whole = matched[2] === "" ? 0 : Number(matched[2]);
  const fraction = (matched[3] ?? "").padEnd(2, "0").slice(0, 2);
  const cents = whole * 100 + Number(fraction);
  const exponent = matched[4] === void 0 ? 0 : Number(matched[4]);
  const scaled = exponent === 0 ? cents : cents * 10 ** exponent;
  return Number.isFinite(scaled) ? sign * Math.round(scaled) : null;
}
function sumWallets(wallets, bonusWallets) {
  const totals = /* @__PURE__ */ new Map();
  const add = (list, field) => {
    for (const wallet of Array.isArray(list) ? list : []) {
      const cents = parseAmountToCents(wallet?.balance);
      if (cents === null) continue;
      const currency = typeof wallet?.currency === "string" && wallet.currency !== "" ? wallet.currency : "CNY";
      const entry = totals.get(currency) ?? { currency, cents: 0, topUpCents: 0, bonusCents: 0 };
      entry[field] += cents;
      entry.cents += cents;
      totals.set(currency, entry);
    }
  };
  add(wallets, "topUpCents");
  add(bonusWallets, "bonusCents");
  if (totals.size === 0) return null;
  const entries = [...totals.values()];
  return entries.find((entry) => entry.cents !== 0) ?? entries[0];
}
function formatCents(cents, currency) {
  const symbol = currencySymbolOf(currency);
  if (cents === 0) return `${symbol}0.00`;
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const text = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
  const grouped = text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${symbol}${grouped}`;
}
function currencySymbolOf(currency) {
  if (currency === "CNY") return "¥";
  if (currency === "USD") return "$";
  return `${currency} `;
}
function symbolOf(currency) {
  if (currency === "CNY") return "¥";
  if (currency === "USD") return "$";
  return `${currency} `;
}

// src/client/balance.js
var LOADING = { state: "loading", available: false, wallets: [], bonusWallets: [], error: null, stale: false, updatedAt: 0 };
var RETRY_BACKOFF_MS = [5e3, 15e3, 6e4];
function createBalanceStore(ctx) {
  let snapshot = LOADING;
  let account = void 0;
  let disabled = false;
  const listeners = /* @__PURE__ */ new Set();
  let inflight = null;
  let failures = 0;
  let retryTimer = null;
  const source = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
  const publish = (next) => {
    if (next.state === snapshot.state && next.available === snapshot.available && next.error === snapshot.error && next.stale === snapshot.stale && next.wallets === snapshot.wallets && next.bonusWallets === snapshot.bonusWallets) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const fail = (error) => {
    failures += 1;
    const keep = snapshot.state === "ready";
    publish({
      state: "failed",
      available: true,
      // 有旧值就继续用它显示，只把它标成「过期」
      wallets: keep ? snapshot.wallets : [],
      bonusWallets: keep ? snapshot.bonusWallets : [],
      error,
      stale: keep,
      updatedAt: keep ? snapshot.updatedAt : Date.now()
    });
    if (disabled || retryTimer !== null) return;
    const wait = RETRY_BACKOFF_MS[Math.min(failures - 1, RETRY_BACKOFF_MS.length - 1)];
    retryTimer = setTimeout(() => {
      retryTimer = null;
      refresh();
    }, wait);
  };
  const refresh = () => {
    if (disabled) return Promise.resolve();
    if (inflight !== null) return inflight;
    if (account === void 0 || typeof account.getBalance !== "function") {
      publish(LOADING);
      return Promise.resolve();
    }
    inflight = (async () => {
      try {
        const language = ctx.locale.getSnapshot().active;
        const result = await account.getBalance(accountClientMetadata(language));
        if (result === void 0 || result === null || result.ok !== true) {
          fail(result?.error?.code ?? "unknown");
          return;
        }
        const value = result.value;
        if (value === null || value === void 0) {
          publish({ state: "signed-out", available: true, wallets: [], bonusWallets: [], error: null, updatedAt: Date.now() });
          return;
        }
        failures = 0;
        publish({
          state: "ready",
          available: true,
          wallets: Array.isArray(value.value) ? value.value : [],
          bonusWallets: Array.isArray(value.bonusWallets) ? value.bonusWallets : [],
          error: null,
          stale: false,
          updatedAt: Date.now()
        });
      } catch (error) {
        fail(String(error?.message ?? error));
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
  const timer = setInterval(refresh, BALANCE_POLL_MS);
  return {
    source,
    refresh,
    /** 账号 Remote 到位后接上（由 `ctx.inject(['remote.account'], …)` 调用）。 */
    attachAccount: (value) => {
      account = value;
      publish({ ...snapshot, available: true });
      refresh();
    },
    dispose: () => {
      disabled = true;
      clearInterval(timer);
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      listeners.clear();
    }
  };
}

// src/client/dictionary.js
var zh = {
  "cost.unavailable": "花费 —",
  "cost.session": "会话 {amount}",
  "cost.turn": "{label} {amount}",
  "cost.turnBare": "{amount}",
  "cost.sessionBare": "{amount}",
  "period.bare": "{period}",
  "balance.bare": "{amount}",
  "balance.word": "余额",
  "cost.turnNow": "本轮",
  "cost.hint": "本轮与会话的模型花费；点击看分项。单价取官方价目，按每次调用发生时刻的波峰/波谷计价。",
  "period.peak": "波峰",
  "period.offPeak": "波谷",
  "period.now": "{period}",
  "period.next": "{countdown}",
  "period.rule": "高峰时段：北京时间周一至周五 9:00–12:00、14:00–18:00（法定节假日除外）；其余时间（含周末与节假日全天）为空闲时段，单价减半。",
  "period.peakFull": "波峰（高峰价）",
  "period.offPeakHalf": "波谷（空闲价，半价）",
  "balance.loading": "余额 …",
  "balance.failed": "余额 取不到",
  "balance.value": "余额 {amount}",
  "balance.hint": "DeepSeek 开放平台账户余额（充值 + 赠金），每分钟刷新一次",
  "dialog.title": "模型花费",
  "dialog.period": "当前时段",
  "dialog.periodUnknown": "未知（拿不到时段表）",
  "dialog.switchIn": "距切换",
  "dialog.lastCall": "最近一次调用",
  "dialog.peakTotal": "波峰累计",
  "dialog.offPeakTotal": "波谷累计",
  "dialog.calls": "计费调用",
  "dialog.buckets": "Token 明细",
  "dialog.models": "按模型",
  "dialog.unpriced": "有 {calls} 次调用（{tokens} tok）在价格表里没有对应单价，未计入金额。",
  "dialog.unpricedTag": "未计价",
  "dialog.balance": "账户余额",
  "dialog.wallet": "充值余额",
  "dialog.bonus": "赠送余额",
  "dialog.balanceTotal": "余额合计（充值 + 赠送）",
  "dialog.source": "单价出自 DeepSeek 官方价目（元/百万 tokens，波谷为波峰半价）；金额按提供方回报的 token 用量折算。",
  "dialog.sourceLink": "定价页",
  "bucket.cacheHit": "输入·缓存命中",
  "bucket.cacheMiss": "输入·缓存未命中",
  "bucket.cacheWrite": "输入·缓存写入",
  "bucket.output": "输出"
};
var en = {
  "cost.unavailable": "Cost —",
  "cost.session": "Session {amount}",
  "cost.turn": "{label} {amount}",
  "cost.turnBare": "{amount}",
  "cost.sessionBare": "{amount}",
  "period.bare": "{period}",
  "balance.bare": "{amount}",
  "balance.word": "Balance",
  "cost.turnNow": "Turn",
  "cost.hint": "Model spend for this turn and session; click for the breakdown. Prices come from the official price list, charged at the peak/off-peak rate in effect when each call happened.",
  "period.peak": "Peak",
  "period.offPeak": "Off-peak",
  "period.now": "{period}",
  "period.next": "{countdown}",
  "period.rule": "Peak hours: Mon–Fri 09:00–12:00 and 14:00–18:00 Beijing time, excluding Chinese public holidays. All other hours (weekends and holidays included) are off-peak at half price.",
  "period.peakFull": "Peak (full rate)",
  "period.offPeakHalf": "Off-peak (half rate)",
  "balance.loading": "Balance …",
  "balance.failed": "Balance n/a",
  "balance.value": "Balance {amount}",
  "balance.hint": "DeepSeek Platform account balance (top-up + bonus), refreshed once a minute",
  "dialog.title": "Model spend",
  "dialog.period": "Current period",
  "dialog.periodUnknown": "unknown (no schedule)",
  "dialog.switchIn": "Switches in",
  "dialog.lastCall": "Last call",
  "dialog.peakTotal": "Peak total",
  "dialog.offPeakTotal": "Off-peak total",
  "dialog.calls": "Billed calls",
  "dialog.buckets": "Token breakdown",
  "dialog.models": "By model",
  "dialog.unpriced": "{calls} calls ({tokens} tok) have no configured price and are excluded from the amount.",
  "dialog.unpricedTag": "unpriced",
  "dialog.balance": "Account balance",
  "dialog.wallet": "Top-up balance",
  "dialog.bonus": "Bonus balance",
  "dialog.balanceTotal": "Total (top-up + bonus)",
  "dialog.source": "Prices come from the official DeepSeek price list (per 1M tokens; off-peak is half of peak); amounts use the provider-reported token usage.",
  "dialog.sourceLink": "pricing page",
  "bucket.cacheHit": "Input · cache hit",
  "bucket.cacheMiss": "Input · cache miss",
  "bucket.cacheWrite": "Input · cache write",
  "bucket.output": "Output"
};

// src/client/pills.jsx
var import_react = require("react");
var import_react_dom = require("react-dom");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/client/icons.jsx
var import_jsx_runtime = require("react/jsx-runtime");
function IconYuanCoinOutlineRegular({ size = 16, className, strokeWidth = 1 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      className,
      viewBox: "0 0 16 16",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": "true",
      strokeWidth,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 14C11.3137 14 14 11.3137 14 8C14 4.68629 11.3137 2 8 2C4.68629 2 2 4.68629 2 8C2 11.3137 4.68629 14 8 14Z", stroke: "currentColor" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.7 5.2L8 8L10.3 5.2", stroke: "currentColor" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M8 8V11.5", stroke: "currentColor" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.9 8.75H10.1", stroke: "currentColor" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M5.9 10.15H10.1", stroke: "currentColor" })
      ]
    }
  );
}
function IconWalletCardOutlineRegular({ size = 16, className, strokeWidth = 1 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "svg",
    {
      width: size,
      height: size,
      className,
      viewBox: "0 0 16 16",
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      "aria-hidden": "true",
      strokeWidth,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "path",
          {
            d: "M4 4.6H12C13.1046 4.6 14 5.49543 14 6.6V9.4C14 10.5046 13.1046 11.4 12 11.4H4C2.89543 11.4 2 10.5046 2 9.4V6.6C2 5.49543 2.89543 4.6 4 4.6Z",
            stroke: "currentColor"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M2 7.2H14", stroke: "currentColor" })
      ]
    }
  );
}

// src/client/styles.js
var CLASS = {
  root: "dcm_root",
  anchor: "dcm_anchor",
  pill: "dcm_pill",
  label: "dcm_label",
  sep: "dcm_sep",
  optional: "dcm_optional",
  panel: "dcm_panel",
  title: "dcm_title",
  titleLabel: "dcm_titleLabel",
  titleValue: "dcm_titleValue",
  rule: "dcm_rule",
  details: "dcm_details",
  route: "dcm_route",
  section: "dcm_section",
  note: "dcm_note",
  warn: "dcm_warn"
};
var CSS = `
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
`;
function installStyles(document_) {
  const marker = "dsh-cost-meter";
  const existing = document_.querySelector(`style[data-plugin-css="${marker}"]`);
  if (existing !== null) {
    if (existing.textContent !== CSS) existing.textContent = CSS;
    return;
  }
  const tag = document_.createElement("style");
  tag.dataset.plugin = marker;
  tag.dataset.pluginCss = marker;
  tag.textContent = CSS;
  document_.head.appendChild(tag);
}

// src/client/compact.js
var DROP_ORDER = ["countdown", "session", "balanceLabel", "word", "period"];
var FALLBACK_GAP = 10;
var MAX_DROP_LEVEL = DROP_ORDER.length - 1;
function minimumRowWidth({ cost, period, balance, gap = FALLBACK_GAP }) {
  const sum = (Number(cost) || 0) + (Number(period) || 0) + (Number(balance) || 0);
  return sum <= 0 ? 0 : sum + gap * 2;
}
function remainingWidthAt(level, parts, total) {
  let cut = 0;
  for (let i = 0; i < level && i < DROP_ORDER.length; i += 1) cut += Number(parts?.[DROP_ORDER[i]]) || 0;
  return total - cut;
}
function pickCompactLevel({ room, total, parts, gap = FALLBACK_GAP }) {
  if (!Number.isFinite(room) || !Number.isFinite(total)) return 0;
  if (remainingWidthAt(0, parts, total) <= room) return 0;
  for (let level = 1; level <= MAX_DROP_LEVEL; level += 1) {
    if (remainingWidthAt(level, parts, total) <= room) return level;
  }
  return MAX_DROP_LEVEL;
}
function shouldUseDock({ room, minWidth, wasDock, slack, rowWidth }) {
  if (Number.isFinite(rowWidth) && rowWidth <= 0) return wasDock === true;
  if (!Number.isFinite(room)) return wasDock === true;
  const need = Number.isFinite(minWidth) ? minWidth : 0;
  const band = Number.isFinite(slack) ? slack : Math.max(24, need * 0.2);
  return wasDock === true ? room < need + band : room < need;
}
function relaxSlack(total) {
  return Number.isFinite(total) && total > 0 ? Math.max(24, total * 0.1) : 24;
}
function nextCompactLevel({ room, total, parts, current, gap = FALLBACK_GAP }) {
  const target = pickCompactLevel({ room, total, parts, gap });
  if (target >= current) return target;
  const strict = pickCompactLevel({ room: room - relaxSlack(total), total, parts, gap });
  return strict <= target ? target : current;
}
function measurableBox(element, maxDepth = 6) {
  let node = element;
  for (let depth = 0; node !== null && node !== void 0 && depth < maxDepth; depth += 1) {
    if (typeof node.getBoundingClientRect === "function") {
      const rect = node.getBoundingClientRect();
      if (Number.isFinite(rect?.width) && rect.width > 0) return node;
    }
    node = node.parentElement ?? null;
  }
  return null;
}
function contentExtent(element) {
  if (element === null || element === void 0) return 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const child of element.children) {
    const rect = child.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    min = Math.min(min, rect.left);
    max = Math.max(max, rect.right);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const own = element.getBoundingClientRect();
    return Number.isFinite(own.width) ? own.width : 0;
  }
  return Math.max(0, max - min);
}
function measureParts(root) {
  const width = (element) => {
    if (element === null) return 0;
    const rect = element.getBoundingClientRect();
    return Number.isFinite(rect.width) ? rect.width : 0;
  };
  const sum = (selector) => [...root.querySelectorAll(selector)].reduce((total2, element) => total2 + width(element), 0);
  const pills = [...root.children];
  const computed = typeof getComputedStyle === "function" ? getComputedStyle(root) : null;
  const rawGap = computed === null ? "" : computed.columnGap === "normal" ? computed.gap : computed.columnGap;
  const parsedGap = Number.parseFloat(String(rawGap));
  const gap = Number.isFinite(parsedGap) && parsedGap >= 0 ? parsedGap : FALLBACK_GAP;
  const gapTotal = Math.max(0, pills.length - 1) * gap;
  const parts = {
    session: sum(".dcm_session"),
    countdown: sum(".dcm_optional"),
    balance: width(root.querySelector("[data-cost-balance]")),
    balanceLabel: width(root.querySelector(".dcm_balanceWord")),
    period: width(root.querySelector("[data-cost-period]"))
  };
  const total = pills.reduce((sum2, pill) => sum2 + width(pill), 0) + gapTotal;
  const costPill = root.querySelector(".dcm_anchor");
  return { total, parts, gap, cost: width(costPill) };
}

// src/client/diagnose.js
function collect(reason) {
  const round = (value) => Math.round(value * 10) / 10;
  const rect = (element) => {
    if (element === null || element === void 0) return null;
    const box = element.getBoundingClientRect();
    return {
      left: round(box.left),
      top: round(box.top),
      width: round(box.width),
      height: round(box.height),
      right: round(box.right),
      bottom: round(box.bottom)
    };
  };
  const style = (element, props) => {
    if (element === null || element === void 0) return null;
    const computed = getComputedStyle(element);
    const out = {};
    for (const prop of props) out[prop] = computed.getPropertyValue(prop);
    return out;
  };
  const describe = (element) => element === null || element === void 0 ? null : {
    tag: element.tagName,
    className: typeof element.className === "string" ? element.className.slice(0, 60) : "",
    dataChatRunning: element.hasAttribute("data-chat-running"),
    dataTurnTail: element.getAttribute("data-turn-tail"),
    rect: rect(element),
    style: style(element, ["display", "flex-direction", "flex-wrap", "align-items", "justify-content", "position", "width", "overflow"])
  };
  const mine = document.querySelector("[data-cost-meter]");
  const allMine = [...document.querySelectorAll("[data-cost-meter]")].map((element) => ({
    rect: rect(element),
    placement: element.getAttribute("data-placement"),
    compact: element.getAttribute("data-compact"),
    parent: element.parentElement === null ? null : {
      tag: element.parentElement.tagName,
      className: typeof element.parentElement.className === "string" ? element.parentElement.className.slice(0, 40) : "",
      running: element.parentElement.hasAttribute("data-chat-running"),
      tail: element.parentElement.getAttribute("data-turn-tail")
    }
  }));
  const rows = [...document.querySelectorAll("[data-chat-running], [data-turn-tail]")];
  return {
    reason,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    column: describe(document.querySelector("[data-chat-flow]")),
    mineCount: allMine.length,
    allMine,
    rows: rows.map((row) => ({
      ...describe(row),
      children: [...row.children].map((child) => ({
        ...describe(child),
        isMine: child.hasAttribute("data-cost-meter"),
        position: getComputedStyle(child).position
      }))
    })),
    mine: mine === null ? null : {
      ...describe(mine),
      placement: mine.getAttribute("data-placement"),
      compact: mine.getAttribute("data-compact"),
      text: mine.textContent,
      pills: [...mine.children].map((pill) => ({ className: String(pill.className).slice(0, 40), rect: rect(pill) }))
    }
  };
}
function createLayoutReporter() {
  const MIN_INTERVAL_MS = 700;
  let lastAt = 0;
  let inflight = false;
  return (reason) => {
    const now = Date.now();
    if (inflight || now - lastAt < MIN_INTERVAL_MS) return;
    lastAt = now;
    inflight = true;
    let payload;
    try {
      payload = collect(reason);
    } catch {
      inflight = false;
      return;
    }
    try {
      fetch("/api/cost-meter/diag", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {
      }).finally(() => {
        inflight = false;
      });
    } catch {
      inflight = false;
    }
  };
}

// src/shared/pricing.js
var NANO_PER_UNIT = 1e9;
var RATE_FIELDS = ["cacheHit", "cacheMiss", "cacheWrite", "output"];
function currencySymbol(currency) {
  if (currency === "CNY") return "¥";
  if (currency === "USD") return "$";
  return `${currency} `;
}
function readRates(raw, where) {
  if (raw === null || typeof raw !== "object") throw new Error(`${where} 不是对象`);
  const rates = {};
  for (const field of RATE_FIELDS) {
    const value = raw[field];
    if (value === void 0) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${where}.${field} 不是非负数字：${JSON.stringify(value)}`);
    }
    rates[field] = value;
  }
  if (rates.cacheMiss === void 0 || rates.output === void 0) {
    throw new Error(`${where} 必须给出 cacheMiss 与 output 单价`);
  }
  if (rates.cacheHit === void 0) rates.cacheHit = rates.cacheMiss;
  if (rates.cacheWrite === void 0) rates.cacheWrite = rates.cacheMiss;
  return rates;
}
function normalizePriceTable(input) {
  const source = input ?? {};
  const currency = typeof source.currency === "string" && source.currency !== "" ? source.currency : "CNY";
  const rawModels = source.models ?? {};
  if (rawModels === null || typeof rawModels !== "object") throw new Error("pricing.models 不是对象");
  const models = {};
  for (const [key, entry] of Object.entries(rawModels)) {
    if (entry === null || typeof entry !== "object") throw new Error(`pricing.models[${key}] 不是对象`);
    models[key] = {
      label: typeof entry.label === "string" && entry.label !== "" ? entry.label : key,
      peak: readRates(entry.peak, `pricing.models[${key}].peak`),
      offPeak: readRates(entry.offPeak, `pricing.models[${key}].offPeak`)
    };
  }
  const defaultKey = typeof source.defaultModel === "string" && source.defaultModel !== "" ? source.defaultModel : null;
  if (defaultKey !== null && models[defaultKey] === void 0) {
    throw new Error(`pricing.defaultModel 指向未定义的型号：${defaultKey}`);
  }
  return { currency, models, defaultKey };
}
function lookupPrice(table, provider, model) {
  const candidates = [];
  if (typeof provider === "string" && provider !== "" && typeof model === "string" && model !== "") {
    candidates.push(`${provider}/${model}`);
  }
  if (typeof model === "string" && model !== "") candidates.push(model);
  if (table.defaultKey !== null) candidates.push(table.defaultKey);
  for (const candidate of candidates) {
    const entry = table.models[candidate];
    if (entry !== void 0) return { key: candidate, label: entry.label, rates: entry };
  }
  return null;
}
function bucketsOf(usage) {
  return {
    cacheMiss: Math.max(0, Math.trunc(usage?.inputTokens ?? 0)),
    cacheHit: Math.max(0, Math.trunc(usage?.cacheReadTokens ?? 0)),
    cacheWrite: Math.max(0, Math.trunc(usage?.cacheWriteTokens ?? 0)),
    output: Math.max(0, Math.trunc(usage?.outputTokens ?? 0))
  };
}
function tokensOf(buckets) {
  return buckets.cacheMiss + buckets.cacheHit + buckets.cacheWrite + buckets.output;
}
function priceUsage({ table, provider, model, period, usage }) {
  const buckets = bucketsOf(usage);
  const tokens = tokensOf(buckets);
  const found = lookupPrice(table, provider, model);
  if (found === null || tokens === 0) {
    return {
      priced: false,
      key: found === null ? null : found.key,
      label: found === null ? null : found.label,
      nano: 0,
      nanoByBucket: { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0 },
      buckets,
      tokens
    };
  }
  const rates = period === "peak" ? found.rates.peak : found.rates.offPeak;
  const nanoByBucket = {
    cacheHit: Math.round(buckets.cacheHit * rates.cacheHit * 1e3),
    cacheMiss: Math.round(buckets.cacheMiss * rates.cacheMiss * 1e3),
    cacheWrite: Math.round(buckets.cacheWrite * rates.cacheWrite * 1e3),
    output: Math.round(buckets.output * rates.output * 1e3)
  };
  const nano = nanoByBucket.cacheHit + nanoByBucket.cacheMiss + nanoByBucket.cacheWrite + nanoByBucket.output;
  return { priced: true, key: found.key, label: found.label, nano, nanoByBucket, buckets, tokens };
}
function formatMoney(nano, currency = "CNY") {
  const symbol = currencySymbol(currency);
  const negative = nano < 0;
  const sign = negative ? "-" : "";
  const value = Math.abs(nano) / NANO_PER_UNIT;
  if (value === 0) return `${sign}${symbol}0.00`;
  if (value < 0.01) {
    const text = trimZeros(value.toFixed(6));
    return text === "0" ? `${sign}${symbol}<0.000001` : `${sign}${symbol}${text}`;
  }
  if (value < 1) return `${sign}${symbol}${trimZeros(value.toFixed(4))}`;
  if (value < 1e3) return `${sign}${symbol}${value.toFixed(2)}`;
  return `${sign}${symbol}${value.toFixed(0)}`;
}
function trimZeros(text) {
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}
function formatTokens(count) {
  const value = Math.max(0, Math.trunc(count));
  if (value >= 1e9) return `${trimZeros((value / 1e9).toFixed(1))}B`;
  if (value >= 1e6) return `${trimZeros((value / 1e6).toFixed(1))}M`;
  if (value >= 1e3) return `${trimZeros((value / 1e3).toFixed(1))}K`;
  return String(value);
}

// src/client/estimate.js
var CHARS_PER_TOKEN = 4;
function partialChars(partial) {
  const blocks = partial?.blocks;
  if (!Array.isArray(blocks)) return 0;
  let chars = 0;
  for (const block of blocks) {
    if (block === null || typeof block !== "object") continue;
    if ((block.kind === "text" || block.kind === "reasoning") && typeof block.text === "string") {
      chars += block.text.length;
    } else if (block.kind === "tool-call") {
      if (typeof block.name === "string") chars += block.name.length;
      if (typeof block.arguments === "string") chars += block.arguments.length;
    }
  }
  return chars;
}
function estimateInFlightNano({ pricing, previousBuckets, chars, model, period }) {
  if (!(chars > 0) || pricing === void 0 || pricing === null) return 0;
  let table;
  try {
    table = normalizePriceTable(pricing);
  } catch {
    return 0;
  }
  const priced = priceUsage({
    table,
    model: model ?? pricing.defaultModel ?? void 0,
    period: period ?? "offPeak",
    usage: {
      inputTokens: previousBuckets?.cacheMiss ?? 0,
      cacheReadTokens: previousBuckets?.cacheHit ?? 0,
      cacheWriteTokens: previousBuckets?.cacheWrite ?? 0,
      outputTokens: Math.ceil(chars / CHARS_PER_TOKEN)
    }
  });
  return priced.priced ? priced.nano : 0;
}

// src/shared/schedule.js
var BEIJING_OFFSET_MINUTES = 480;
function scheduleFromWire(wire) {
  const windows = (wire?.windows ?? []).map(([start, end]) => [Number(start), Number(end)]);
  const holidayList = (wire?.holidays ?? []).map(String);
  return {
    offsetMinutes: Number.isFinite(wire?.offsetMinutes) ? Number(wire.offsetMinutes) : BEIJING_OFFSET_MINUTES,
    windows,
    holidayList,
    holidays: new Set(holidayList)
  };
}
function beijingParts(ms, offsetMinutes = BEIJING_OFFSET_MINUTES) {
  const shifted = new Date(ms + offsetMinutes * 6e4);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  return {
    year,
    month,
    day,
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    dateKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  };
}
function isPeakAt(ms, schedule) {
  const parts = beijingParts(ms, schedule.offsetMinutes);
  if (parts.weekday === 0 || parts.weekday === 6) return false;
  if (schedule.holidays.has(parts.dateKey)) return false;
  return schedule.windows.some(([start, end]) => parts.minutes >= start && parts.minutes < end);
}
function periodAt(ms, schedule) {
  return isPeakAt(ms, schedule) ? "peak" : "offPeak";
}
function dayStartMs(dateKey, offsetMinutes) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day) - offsetMinutes * 6e4;
}
function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}
function nextPeriodChangeAt(ms, schedule) {
  const current = isPeakAt(ms, schedule);
  const today = beijingParts(ms, schedule.offsetMinutes).dateKey;
  const candidates = [];
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const dateKey = shiftDateKey(today, dayOffset);
    const dayStart = dayStartMs(dateKey, schedule.offsetMinutes);
    candidates.push(dayStart);
    for (const [start, end] of schedule.windows) {
      candidates.push(dayStart + start * 6e4);
      candidates.push(dayStart + end * 6e4);
    }
  }
  const upcoming = candidates.filter((value) => value > ms).sort((left, right) => left - right);
  for (const candidate of upcoming) {
    if (isPeakAt(candidate, schedule) !== current) return candidate;
  }
  return ms + 24 * 60 * 60 * 1e3;
}
function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1e3));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

// src/client/pills.jsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var instanceSeq = 0;
var activeInstance = null;
var instanceListeners = /* @__PURE__ */ new Set();
var OWNER_ATTR = "data-dcm-owner";
var reportLayout = createLayoutReporter();
var PRICING_URL = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing";
function useNow(active) {
  const [now, setNow] = (0, import_react.useState)(() => Date.now());
  (0, import_react.useEffect)(() => {
    if (!active) return void 0;
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
function usePanelPosition(anchorRef, open) {
  const [position, setPosition] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    if (!open) {
      setPosition(null);
      return void 0;
    }
    const measure = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect === void 0) return;
      const width = Math.min(460, window.innerWidth - 24);
      const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
      setPosition({ left, bottom: Math.max(12, window.innerHeight - rect.top + 8) });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchorRef, open]);
  return position;
}
function useAnchorRow() {
  const [anchor, setAnchor] = (0, import_react.useState)({ kind: "dock", node: null });
  (0, import_react.useEffect)(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return void 0;
    const scan = () => {
      const running = document.querySelector("[data-chat-running]");
      if (running !== null) return { kind: "running", node: running };
      const tails = document.querySelectorAll("[data-turn-tail]");
      const last = tails.length > 0 ? tails[tails.length - 1] : null;
      return last === null ? { kind: "dock", node: null } : { kind: "tail", node: last };
    };
    const sync = () => {
      const next = scan();
      setAnchor((current) => current.node === next.node && current.kind === next.kind ? current : next);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return anchor;
}
function useDismiss(open, close, anchorRef, panelRef) {
  (0, import_react.useEffect)(() => {
    if (!open) return void 0;
    const onPointerDown = (event) => {
      const target = event.target;
      if (panelRef.current?.contains(target) === true) return;
      if (anchorRef.current?.contains(target) === true) return;
      close();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, anchorRef, panelRef]);
}
function walletTotal(wallets, bonusWallets) {
  return sumWallets(wallets, bonusWallets);
}
function Row({ label, value }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dt", { children: label }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dd", { children: value })
  ] });
}
function CostPills({ useProjection, useChat, useSession, useBalance, refreshBalance, t }) {
  const cost = useProjection(PROJECTION_KEY);
  const running = useSession((value) => value.running);
  const balance = useBalance((value) => value);
  const hasChat = typeof useChat === "function";
  const useChatSafe = hasChat ? useChat : () => 0;
  const liveChars = useChatSafe((snapshot) => partialChars(snapshot?.legacy?.partial));
  const liveTurn = useChatSafe((snapshot) => {
    const value = snapshot?.legacy?.partial?.turn;
    return typeof value === "number" ? value : -1;
  });
  const schedule = (0, import_react.useMemo)(
    () => cost?.schedule === void 0 ? null : scheduleFromWire(cost.schedule),
    [cost?.schedule]
  );
  const now = useNow(schedule !== null);
  const [instanceId] = (0, import_react.useState)(() => {
    instanceSeq += 1;
    if (activeInstance === null) activeInstance = instanceSeq;
    return instanceSeq;
  });
  const [myToken] = (0, import_react.useState)(() => `dcm-${instanceId}-${Date.now()}`);
  const owns = typeof document === "undefined" || (() => {
    const body = document.body;
    let current = body.getAttribute(OWNER_ATTR);
    if (current === null) {
      body.setAttribute(OWNER_ATTR, myToken);
      current = myToken;
    }
    return current === myToken;
  })();
  const [, forceInstance] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    const listener = () => forceInstance((value) => value + 1);
    instanceListeners.add(listener);
    return () => {
      instanceListeners.delete(listener);
      if (activeInstance === instanceId) {
        activeInstance = null;
        for (const notify of [...instanceListeners]) notify();
      }
      if (typeof document !== "undefined" && document.body.getAttribute(OWNER_ATTR) === myToken) {
        document.body.removeAttribute(OWNER_ATTR);
      }
    };
  }, [instanceId, myToken]);
  const isActiveInstance = activeInstance === null || activeInstance === instanceId;
  if (isActiveInstance && activeInstance === null) activeInstance = instanceId;
  const anchor = useAnchorRow();
  const [open, setOpen] = (0, import_react.useState)(false);
  const [compact, setCompact] = (0, import_react.useState)(0);
  const [availableWidth, setAvailableWidth] = (0, import_react.useState)(null);
  const [inDock, setInDock] = (0, import_react.useState)(false);
  const compactRef = (0, import_react.useRef)(0);
  compactRef.current = compact;
  const partsRef = (0, import_react.useRef)(null);
  const rootRef = (0, import_react.useRef)(null);
  const anchorRef = (0, import_react.useRef)(null);
  const panelRef = (0, import_react.useRef)(null);
  const position = usePanelPosition(anchorRef, open);
  const close = (0, import_react.useCallback)(() => setOpen(false), []);
  useDismiss(open, close, anchorRef, panelRef);
  const busy = running === true || liveTurn !== -1;
  const calls = cost?.totals?.calls ?? 0;
  const refreshedAt = (0, import_react.useRef)(0);
  const refreshThrottled = (0, import_react.useCallback)(() => {
    if (Date.now() - refreshedAt.current < 2e4) return;
    refreshedAt.current = Date.now();
    refreshBalance();
  }, [refreshBalance]);
  (0, import_react.useEffect)(() => {
    if (calls === 0) return;
    refreshThrottled();
  }, [calls, refreshThrottled]);
  (0, import_react.useEffect)(() => {
    if (!busy) return void 0;
    const timer = setInterval(refreshThrottled, 3e4);
    return () => clearInterval(timer);
  }, [busy, refreshThrottled]);
  const period = schedule === null ? null : periodAt(now, schedule);
  const nextAt = schedule === null ? null : nextPeriodChangeAt(now, schedule);
  const portalNode = !inDock && anchor.kind !== "running" && anchor.node !== null && anchor.node.isConnected ? anchor.node : null;
  const mount = portalNode === null ? "dock" : anchor.kind;
  const currency = cost?.currency ?? "CNY";
  const symbol = symbolOf(currency);
  const totals = cost?.totals;
  const turns = cost?.turns ?? [];
  const diagnosticsOn = cost?.diagnostics === true;
  (0, import_react.useEffect)(() => {
    if (!diagnosticsOn) return void 0;
    reportLayout("anchor");
    const timer = setInterval(() => reportLayout("tick"), 3e3);
    return () => clearInterval(timer);
  }, [diagnosticsOn, anchor.kind, anchor.node]);
  const lastAnchorNodeRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    const root = rootRef.current;
    const anchorNode = anchor.node !== null && anchor.node.isConnected ? anchor.node : null;
    if (lastAnchorNodeRef.current !== anchorNode) {
      lastAnchorNodeRef.current = anchorNode;
      compactRef.current = 0;
      partsRef.current = null;
      setCompact(0);
    }
    const row = anchor.kind === "running" ? null : anchorNode;
    if (root === null || row === null) return void 0;
    let lastMeasuredAt = 0;
    const measure = (force = false) => {
      const now2 = Date.now();
      if (!force && now2 - lastMeasuredAt < 16) return;
      lastMeasuredAt = now2;
      if (!inDock) {
        const clamp = root.style.maxWidth;
        if (clamp !== "") root.style.maxWidth = "none";
        partsRef.current = measureParts(root);
        if (clamp !== "") root.style.maxWidth = clamp;
      }
      const box = measurableBox(row) ?? row;
      const rowWidth = box.getBoundingClientRect().width;
      if (!(rowWidth > 0) || !(partsRef.current?.total > 0)) return;
      const core = [...box.children].filter((child) => child !== root);
      const coreWidth = core.reduce((widest, child) => {
        const width = contentExtent(child);
        const own = child.getBoundingClientRect().width;
        const leafDecoration = child.children.length === 0 && own >= rowWidth - 1;
        if (!(width > 0) || leafDecoration) return widest;
        return Math.max(widest, width);
      }, 0);
      const parts = partsRef.current;
      const gap = parts.gap ?? 0;
      const safety = Math.max(24, rowWidth * 0.07);
      const RIGHT_RESERVE = 28;
      const room = rowWidth - coreWidth - gap * 2 - safety - RIGHT_RESERVE;
      if (!inDock) {
        setCompact(nextCompactLevel({
          room,
          total: parts.total,
          // 'word' 这一档没有对应的 DOM 元素可量：标签文字大约占整组的 28%，
          // 按比例估一个值，否则估算会以为「丢了 word 没省地方」，从而把级别判得更狠或干脆裁掉。
          parts: { ...parts.parts, word: parts.total * 0.28 },
          current: compactRef.current,
          gap
        }));
        const nextWidth = room > 0 ? Math.floor(room) : null;
        setAvailableWidth((current) => {
          if (current === nextWidth) return current;
          if (current !== null && nextWidth !== null && Math.abs(current - nextWidth) <= 1) return current;
          return nextWidth;
        });
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
          gap: parts.gap
        }) * 0.92,
        wasDock: was
      }));
    };
    measure(true);
    const settle = [setTimeout(() => measure(true), 32), setTimeout(() => measure(true), 120)];
    const contentTick = setInterval(() => measure(), 500);
    const onResize = () => measure();
    if (typeof window !== "undefined") window.addEventListener("resize", onResize);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => measure()) : null;
    observer?.observe(row);
    observer?.observe(root);
    return () => {
      for (const timer of settle) clearTimeout(timer);
      clearInterval(contentTick);
      if (typeof window !== "undefined") window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [anchor.node, anchor.kind, inDock, cost, turns.length, balance?.state]);
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const sampledChars = (0, import_react.useRef)(0);
  const [estChars, setEstChars] = (0, import_react.useState)(0);
  (0, import_react.useEffect)(() => {
    if (liveChars === sampledChars.current) return void 0;
    const timer = setTimeout(() => {
      sampledChars.current = liveChars;
      setEstChars(liveChars);
    }, 500);
    return () => clearTimeout(timer);
  }, [liveChars]);
  const inFlightNano = (0, import_react.useMemo)(
    () => estimateInFlightNano({
      pricing: cost?.pricing,
      previousBuckets: cost?.last?.buckets,
      chars: Math.max(liveChars, estChars),
      model: cost?.last?.key ?? cost?.pricing?.defaultModel ?? void 0,
      period: period ?? "offPeak"
    }),
    [liveChars, estChars, cost, period]
  );
  const sawCallsRef = (0, import_react.useRef)(false);
  if (totals !== void 0 && totals.calls > 0) sawCallsRef.current = true;
  if (cost !== void 0 && totals.calls === 0 && liveTurn === -1 && !sawCallsRef.current) return null;
  const settledTurnNano = lastTurn !== null && (liveTurn === -1 || lastTurn.turn === liveTurn) ? lastTurn.nano : 0;
  const turnNano = settledTurnNano + inFlightNano;
  const turnIsEstimated = inFlightNano > 0;
  const bareLabels = compact >= DROP_ORDER.indexOf("word") + 1;
  const shownCompact = mount === "dock" ? 0 : compact;
  const shownBareLabels = mount === "dock" ? false : bareLabels;
  const sessionText = totals === void 0 ? t("cost.unavailable") : t(shownBareLabels ? "cost.sessionBare" : "cost.session", { amount: formatMoney(totals.nano, currency) });
  const turnText = cost === void 0 ? null : t(shownBareLabels ? "cost.turnBare" : "cost.turn", {
    label: t("cost.turnNow"),
    amount: turnIsEstimated ? `≈${formatMoney(turnNano, currency)}` : formatMoney(turnNano, currency)
  });
  const showSession = totals !== void 0 && turns.length > 1;
  const showUnavailable = turnText === null;
  const periodText = period === null ? null : t(shownBareLabels ? "period.bare" : "period.now", { period: t(period === "peak" ? "period.peak" : "period.offPeak") });
  const nextText = period === null || nextAt === null ? null : t("period.next", {
    period: t(period === "peak" ? "period.offPeak" : "period.peak"),
    countdown: formatCountdown(nextAt - now)
  });
  const periodTitle = period === null ? void 0 : `${nextText ?? ""}
${t("period.rule")}`;
  const total = balance !== void 0 && balance.state !== "signed-out" && balance.wallets !== void 0 ? walletTotal(balance.wallets, balance.bonusWallets) : null;
  const balanceWord = t("balance.word");
  const balanceAmount = total === null ? null : formatCents(total.cents, total.currency);
  const balanceNotice = (() => {
    if (balance === void 0 || balance.available !== true || balance.state === "signed-out") return null;
    if (balance.state === "loading") return t("balance.loading");
    if (balance.state === "failed" && balance.stale !== true) return t("balance.failed");
    if (total === null) return t("balance.failed");
    return null;
  })();
  const content = /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      ref: rootRef,
      className: CLASS.root,
      "data-cost-meter": true,
      "data-placement": mount,
      "data-compact": DROP_ORDER.slice(0, shownCompact).join(" "),
      style: mount === "dock" || availableWidth === null ? void 0 : { maxWidth: `min(${availableWidth}px, 100%)` },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CLASS.anchor, ref: anchorRef, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "button",
          {
            type: "button",
            className: CLASS.pill,
            "aria-haspopup": "dialog",
            "aria-expanded": open,
            "aria-label": cost === void 0 ? sessionText : `${turnText ?? ""} ${showSession ? sessionText : ""}`.trim(),
            title: cost === void 0 ? t("cost.hint") : `${t("cost.turn", { label: t("cost.turnNow"), amount: turnIsEstimated ? `≈${formatMoney(turnNano, currency)}` : formatMoney(turnNano, currency) })}${showSession ? ` · ${t("cost.session", { amount: formatMoney(totals.nano, currency) })}` : ""}`,
            onClick: () => setOpen((value) => !value),
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconYuanCoinOutlineRegular, {}),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CLASS.label, children: [
                turnText !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                  turnText,
                  showSession && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `${CLASS.sep} dcm_session`, "aria-hidden": "true", children: "·" })
                ] }),
                (showSession || showUnavailable) && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dcm_session", children: sessionText })
              ] })
            ]
          }
        ) }),
        periodText !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CLASS.pill, title: periodTitle, "data-cost-period": period, "data-cost-secondary": "", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.IconClockOutlineRegular, {}),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CLASS.label, children: [
            periodText,
            nextText !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CLASS.sep, "aria-hidden": "true", children: "·" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CLASS.optional, children: nextText })
            ] })
          ] })
        ] }),
        (balanceNotice !== null || balanceAmount !== null) && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "span",
          {
            className: CLASS.pill,
            title: [
              total === null ? null : t("balance.value", { amount: formatCents(total.cents, total.currency) }),
              t("balance.hint"),
              balance?.state === "failed" && balance.error ? balance.error : null
            ].filter(Boolean).join(" · "),
            "data-cost-secondary": "",
            "data-cost-balance": "",
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconWalletCardOutlineRegular, {}),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `${CLASS.label} dcm_balanceLabel`, children: balanceNotice !== null ? balanceNotice : shownBareLabels ? t("balance.bare", { amount: balanceAmount }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dcm_balanceWord", children: balanceWord }),
                " ",
                balanceAmount
              ] }) })
            ]
          }
        ),
        open && position !== null && cost !== void 0 && (0, import_react_dom.createPortal)(
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "div",
            {
              ref: panelRef,
              className: CLASS.panel,
              role: "dialog",
              "aria-label": t("dialog.title"),
              style: { left: position.left, bottom: position.bottom },
              children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(DialogBody, { cost, currency, period, nextAt, now, balance, t })
            }
          ),
          document.body
        )
      ]
    }
  );
  if (!isActiveInstance || !owns) return null;
  return portalNode === null ? content : (0, import_react_dom.createPortal)(content, portalNode);
}
function DialogBody({ cost, currency, period, nextAt, now, balance, t }) {
  const totals = cost.totals;
  const buckets = totals.buckets;
  const money = (nano) => formatMoney(nano, currency);
  const bucketRow = (label, tokens, nano) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label, value: `${formatTokens(tokens)} tok · ${money(nano)}` });
  const byBucket = totals.nanoByBucket ?? { cacheHit: 0, cacheMiss: 0, cacheWrite: 0, output: 0 };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CLASS.title, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: CLASS.titleLabel, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IconYuanCoinOutlineRegular, {}),
        t("dialog.title")
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: CLASS.titleValue, children: money(totals.nano) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: CLASS.rule, "aria-hidden": "true" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("dl", { className: CLASS.details, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: t("dialog.period"), value: period === null ? t("dialog.periodUnknown") : t(period === "peak" ? "period.peakFull" : "period.offPeakHalf") }),
      nextAt !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: t("dialog.switchIn"), value: formatCountdown(nextAt - now) }),
      cost.last !== null && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: t("dialog.lastCall"),
          value: `${money(cost.last.nano)} · ${formatTokens(cost.last.tokens)} tok${cost.last.priced ? "" : ` · ${t("dialog.unpricedTag")}`}`
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: t("dialog.peakTotal"), value: `${money(cost.periods.peak.nano)} · ${formatTokens(cost.periods.peak.tokens)} tok` }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: t("dialog.offPeakTotal"), value: `${money(cost.periods.offPeak.nano)} · ${formatTokens(cost.periods.offPeak.tokens)} tok` }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: t("dialog.calls"), value: String(totals.calls) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: CLASS.section, children: t("dialog.buckets") }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("dl", { className: CLASS.details, children: [
      bucketRow(t("bucket.cacheHit"), buckets.cacheHit, byBucket.cacheHit),
      bucketRow(t("bucket.cacheMiss"), buckets.cacheMiss, byBucket.cacheMiss),
      buckets.cacheWrite > 0 && bucketRow(t("bucket.cacheWrite"), buckets.cacheWrite, byBucket.cacheWrite),
      bucketRow(t("bucket.output"), buckets.output, byBucket.output)
    ] }),
    cost.models.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: CLASS.section, children: t("dialog.models") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dl", { className: CLASS.details, children: cost.models.map((model) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        Row,
        {
          label: model.label ?? model.key,
          value: `${formatTokens(model.tokens)} tok · ${model.priced ? money(model.nano) : t("dialog.unpricedTag")}`
        },
        model.key
      )) })
    ] }),
    totals.unpricedCalls > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: `${CLASS.note} ${CLASS.warn}`, children: t("dialog.unpriced", { calls: totals.unpricedCalls, tokens: formatTokens(totals.unpricedTokens) }) }),
    balance?.state === "ready" && balance.wallets.length + balance.bonusWallets.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: CLASS.section, children: t("dialog.balance") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("dl", { className: CLASS.details, children: (() => {
        const sum = (list) => list.reduce((total, wallet) => total + (parseAmountToCents(wallet?.balance) ?? 0), 0);
        const currency2 = balance.wallets[0]?.currency ?? balance.bonusWallets[0]?.currency ?? "CNY";
        const topUp = sum(balance.wallets);
        const bonus = sum(balance.bonusWallets);
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_jsx_runtime2.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: t("dialog.wallet"), value: formatCents(topUp, currency2) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: t("dialog.bonus"), value: formatCents(bonus, currency2) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Row, { label: t("dialog.balanceTotal"), value: formatCents(topUp + bonus, currency2) })
        ] });
      })() })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: CLASS.note, children: [
      t("dialog.source"),
      " · ",
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("a", { href: PRICING_URL, target: "_blank", rel: "noreferrer", children: t("dialog.sourceLink") })
    ] })
  ] });
}

// src/client/index.jsx
var name = ID;
var inject = ["slots", "locale", "remote"];
function apply(ctx) {
  if (typeof document !== "undefined") installStyles(document);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${ID}: dictionaries`);
  const balance = createBalanceStore(ctx);
  ctx.effect(() => () => balance.dispose(), `${ID}: balance store`);
  ctx.inject(["remote.account"], (accountCtx) => {
    balance.attachAccount(accountCtx.remote.account);
  });
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: `${ID}-live`,
    order: 30,
    locale: NS,
    inject: () => ({
      hooks: { balance: balance.source },
      refreshBalance: balance.refresh
    })
  }, CostPills));
}
return Object.defineProperty({ ...module.exports }, Symbol.toStringTag, { value: 'Module' })
  },
})
